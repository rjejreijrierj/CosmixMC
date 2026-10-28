# CosmixMC

A website for the Cosmix MC Minecraft server, with Lifesteal and Hoplite game modes, a main plugins directory, member accounts, and an admin-published updates feed with image uploads.

## Website setup

Requires Node.js 20.19+ or 22.12+ and a reachable MySQL 8+ or MariaDB database. Create a database and a dedicated website database user, copy `.env.example` to `.env`, and set the database credentials. The website creates its tables on startup. For a local database, an administrator can provision the schema and website user with:

```sql
CREATE DATABASE cosmix CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'cosmix'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-password';
GRANT ALL PRIVILEGES ON cosmix.* TO 'cosmix'@'127.0.0.1';
```

```sh
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL printed in the terminal (usually `http://localhost:5173`). For production, build with `npm run build`, then run `NODE_ENV=production npm start` behind HTTPS. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and optionally `PORT` in the hosting environment.

The first account created becomes the site admin. Later accounts are members. Admins can publish and remove updates, with optional JPG, PNG, GIF, or WebP images up to 8 MB. Uploaded images are stored in `uploads/`; back up that directory when deploying.

## Paper plugin

Build the plugin jar from the repository root with `mvn -f plugin/pom.xml package`, then place `plugin/target/cosmix-link-1.0.0.jar` in the Paper server's `plugins/` directory and restart the server. Edit `plugins/CosmixLink/config.yml` with the same database name and host as the website, plus a dedicated plugin database user. After the website has started and created its tables, a database administrator can grant the plugin only the access it needs (replace the SQL host and password with the Paper server's actual network location and a unique password):

```sql
CREATE USER 'cosmix_plugin'@'paper-server-host' IDENTIFIED BY 'use-a-different-long-password';
GRANT SELECT, DELETE ON cosmix.link_codes TO 'cosmix_plugin'@'paper-server-host';
GRANT SELECT (id, username, minecraft_uuid), UPDATE (minecraft_uuid, minecraft_username)
	ON cosmix.users TO 'cosmix_plugin'@'paper-server-host';
```

Do not expose MySQL/MariaDB publicly; allow only the website and Paper server hosts through the database firewall. For remote database connections, enable SSL and configure trusted certificates appropriately.

Sign in to the website, open account settings, and generate a link code. In game, run `/cosmix link <code>` within 10 minutes. Codes are one-time and are stored as SHA-256 hashes. The player UUID and current Minecraft username are saved on the linked website account. Players can unlink from website account settings.

After a link succeeds, the plugin runs the console commands in `rewards.commands` in `plugins/CosmixLink/config.yml`. Set `rewards.enabled: false` to disable them. Commands support `{player}` (Minecraft name), `{uuid}` (Minecraft UUID), and `{website}` (Cosmix website username). Commands run once, only after the account link is committed; edit the list to choose your rewards, then restart the server.

The server address (`SERVER_ADDRESS`) and example plugin list are configured near the top of `src/main.jsx`. Replace the sample plugin names before launch.