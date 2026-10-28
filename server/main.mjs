import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import multer from 'multer';
import mysql from 'mysql2/promise';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'data');
const uploadDir = path.join(root, 'uploads');
await mkdir(dataDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });

const database = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'cosmix',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'cosmix',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

await database.query('SELECT 1');
await database.query(`
  CREATE TABLE IF NOT EXISTS site_settings (
    id TINYINT UNSIGNED PRIMARY KEY,
    first_admin_created BOOLEAN NOT NULL DEFAULT FALSE
  ) ENGINE=InnoDB
`);
await database.query('INSERT IGNORE INTO site_settings (id, first_admin_created) VALUES (1, FALSE)');
await database.query(`
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    minecraft_uuid CHAR(36) NULL UNIQUE,
    minecraft_username VARCHAR(16) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
await database.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
await database.query(`
  CREATE TABLE IF NOT EXISTS updates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    body TEXT NOT NULL,
    image VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    author_id BIGINT UNSIGNED NOT NULL,
    CONSTRAINT updates_author_fk FOREIGN KEY (author_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
await database.query(`
  CREATE TABLE IF NOT EXISTS link_codes (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at BIGINT UNSIGNED NOT NULL,
    CONSTRAINT link_codes_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX link_codes_expiry_idx (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

const app = express();
const port = Number(process.env.PORT || 3000);
const cookieName = 'cosmix_session';
const sessionLifetime = 1000 * 60 * 60 * 24 * 14;
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(uploadDir, { maxAge: '1d', immutable: true }));

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

async function currentUser(req, _res, next) {
  const token = req.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!token) return next();

  const decodedToken = decodeURIComponent(token);
  const [rows] = await database.query(`
    SELECT users.id, users.username, users.email, users.role, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `, [hashToken(decodedToken)]);
  const session = rows[0];
  if (!session) return next();
  if (session.expires_at < Date.now()) {
    await database.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(decodedToken)]);
    return next();
  }
  const { expires_at, ...user } = session;
  req.user = user;
  req.sessionToken = decodedToken;
  next();
}

app.use('/api', currentUser);

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the site admin can publish updates.' });
  }
  next();
}

function createSession(userId, res) {
  const token = randomBytes(32).toString('hex');
  return database.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [hashToken(token), userId, Date.now() + sessionLifetime]).then(() => res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: sessionLifetime,
    path: '/',
  }));
}

app.get('/api/session', (req, res) => res.json({ user: req.user ?? null }));

app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body ?? {};
  if (typeof username !== 'string' || username.trim().length < 3 || username.trim().length > 20) {
    return res.status(400).json({ error: 'Choose a username between 3 and 20 characters.' });
  }
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Your password must be at least 8 characters.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await database.getConnection();
  try {
    await connection.beginTransaction();
    const [settings] = await connection.query('SELECT first_admin_created FROM site_settings WHERE id = 1 FOR UPDATE');
    const role = settings[0].first_admin_created ? 'member' : 'admin';
    const [result] = await connection.query('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [username.trim(), normalizedEmail, passwordHash, role]);
    if (role === 'admin') await connection.query('UPDATE site_settings SET first_admin_created = TRUE WHERE id = 1');
    await connection.commit();
    const [users] = await database.query('SELECT id, username, email, role, minecraft_uuid, minecraft_username FROM users WHERE id = ?', [result.insertId]);
    const user = users[0];
    await createSession(user.id, res);
    res.status(201).json({ user });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That username or email is already in use.' });
    }
    throw error;
  } finally {
    connection.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const [users] = await database.query('SELECT id, username, email, password_hash, role, minecraft_uuid, minecraft_username FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  const user = users[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const { password_hash, ...safeUser } = user;
  await createSession(user.id, res);
  res.json({ user: safeUser });
});

app.post('/api/logout', async (req, res) => {
  if (req.sessionToken) await database.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(req.sessionToken)]);
  res.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ ok: true });
});

app.get('/api/updates', async (_req, res) => {
  const [updates] = await database.query(`
    SELECT updates.id, updates.title, updates.body, updates.image, updates.created_at, users.username AS author
    FROM updates JOIN users ON users.id = updates.author_id
    ORDER BY updates.created_at DESC, updates.id DESC
  `);
  res.json({ updates });
});

app.get('/api/me/link', requireUser, async (req, res) => {
  const [users] = await database.query('SELECT minecraft_uuid, minecraft_username FROM users WHERE id = ?', [req.user.id]);
  res.json({ linked: Boolean(users[0].minecraft_uuid), minecraftUuid: users[0].minecraft_uuid, minecraftUsername: users[0].minecraft_username });
});

app.post('/api/link-code', requireUser, async (req, res) => {
  const [users] = await database.query('SELECT minecraft_uuid FROM users WHERE id = ?', [req.user.id]);
  if (users[0].minecraft_uuid) return res.status(409).json({ error: 'A Minecraft account is already linked. Unlink it first.' });

  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let codeHash;
  do {
    code = Array.from(randomBytes(8), (byte) => alphabet[byte & 31]).join('');
    codeHash = hashToken(code);
  } while ((await database.query('SELECT 1 FROM link_codes WHERE token_hash = ?', [codeHash]))[0].length);

  const expiresAt = Date.now() + 10 * 60 * 1000;
  await database.query('DELETE FROM link_codes WHERE user_id = ? OR expires_at < ?', [req.user.id, Date.now()]);
  await database.query('INSERT INTO link_codes (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [codeHash, req.user.id, expiresAt]);
  res.status(201).json({ code, expiresAt });
});

app.delete('/api/me/link', requireUser, async (req, res) => {
  await database.query('UPDATE users SET minecraft_uuid = NULL, minecraft_username = NULL WHERE id = ?', [req.user.id]);
  await database.query('DELETE FROM link_codes WHERE user_id = ?', [req.user.id]);
  res.json({ linked: false });
});

const allowedTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
]);
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, uploadDir),
    filename: (_req, file, callback) => callback(null, `${randomBytes(16).toString('hex')}${allowedTypes.get(file.mimetype)}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(null, allowedTypes.has(file.mimetype)),
});

app.post('/api/uploads', requireAdmin, (req, res, next) => {
  imageUpload.single('image')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be smaller than 8 MB.' : 'Choose a JPG, PNG, GIF, or WebP image.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG, GIF, or WebP image.' });
    next();
  });
}, (req, res) => res.status(201).json({ image: `/uploads/${req.file.filename}` }));

app.post('/api/updates', requireAdmin, async (req, res) => {
  const { title, body, image } = req.body ?? {};
  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 100) {
    return res.status(400).json({ error: 'Your title must be between 3 and 100 characters.' });
  }
  if (typeof body !== 'string' || body.trim().length < 1 || body.trim().length > 4000) {
    return res.status(400).json({ error: 'Write an update of up to 4,000 characters.' });
  }
  const safeImage = typeof image === 'string' && /^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif)$/.test(image) ? image : null;
  const [result] = await database.query('INSERT INTO updates (title, body, image, author_id) VALUES (?, ?, ?, ?)',
    [title.trim(), body.trim(), safeImage, req.user.id]);
  const [updates] = await database.query(`
    SELECT updates.id, updates.title, updates.body, updates.image, updates.created_at, users.username AS author
    FROM updates JOIN users ON users.id = updates.author_id WHERE updates.id = ?`, [result.insertId]);
  const update = updates[0];
  res.status(201).json({ update });
});

app.delete('/api/updates/:id', requireAdmin, async (req, res) => {
  const [rows] = await database.query('SELECT image FROM updates WHERE id = ?', [Number(req.params.id)]);
  const update = rows[0];
  if (!update) return res.status(404).json({ error: 'Update not found.' });
  await database.query('DELETE FROM updates WHERE id = ?', [Number(req.params.id)]);
  if (update.image) await unlink(path.join(root, update.image.slice(1))).catch(() => {});
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(root, 'dist')));
  app.get('*splat', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

app.listen(port, () => console.log(`Cosmix MC server ready on http://localhost:${port}`));