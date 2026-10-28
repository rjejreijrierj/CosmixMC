import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, Check, Copy, Crosshair, Heart, ImagePlus, Link2, LogOut, Menu, Shield, Sparkles, Swords, Trash2, Trophy, Unlink, UserRound, X } from 'lucide-react';
import './style.css';

const SERVER_ADDRESS = 'mc.cosmixmc.org';

const games = [
  { name: 'Lifesteal', number: '01', tone: 'red', icon: Heart, tag: 'HIGH STAKES. ONE MORE HEART.', description: 'Every elimination makes you stronger. Every death makes you vulnerable. Build your crew, watch your back, and take hearts to stay alive.', status: 'PLAY NOW' },
  { name: 'Hoplite', number: '02', tone: 'green', icon: Crosshair, tag: 'DROP IN. GEAR UP. BE LAST.', description: 'Outplay the lobby in a fast-moving battle royale. Find your gear, pick your moment, and make the final fight count.', status: 'BATTLE ROYALE' },
];

const plugins = [
  { name: 'Lifesteal', category: 'CORE GAMEPLAY', description: 'Hearts are on the line. Eliminate a player to claim one of theirs.', icon: Heart, color: 'coral', version: 'CUSTOM' },
  { name: 'Hoplite', category: 'BATTLE ROYALE', description: 'A quick, tactical last-player-standing experience.', icon: Crosshair, color: 'lime', version: 'CORE' },
  { name: 'CombatLogX', category: 'COMBAT', description: 'Logging out does not get you out of a fight.', icon: Swords, color: 'orange', version: 'ENABLED' },
  { name: 'EssentialsX', category: 'SERVER', description: 'The useful commands and quality-of-life features players expect.', icon: Sparkles, color: 'blue', version: 'ENABLED' },
  { name: 'LuckPerms', category: 'PERMISSIONS', description: 'Ranks and permissions, carefully managed.', icon: Shield, color: 'violet', version: 'ENABLED' },
  { name: 'PlaceholderAPI', category: 'INTEGRATION', description: 'The little details that make the server feel connected.', icon: Trophy, color: 'yellow', version: 'ENABLED' },
];

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const path = new URL(url, window.location.href).pathname;
    if (response.status === 401 && !['/api/login', '/api/signup'].includes(path)) {
      window.dispatchEvent(new Event('cosmix:auth-expired'));
    }
    throw new Error(data.error || 'Something went wrong. Try again.');
  }
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [accountOpen, setAccountOpen] = useState(false);
  const [minecraftLink, setMinecraftLink] = useState({ linked: false, minecraftUuid: null, minecraftUsername: null });
  const [linkCode, setLinkCode] = useState('');
  const [linkExpiresAt, setLinkExpiresAt] = useState(0);
  const [linkTimeLeft, setLinkTimeLeft] = useState(0);
  const [linkBusy, setLinkBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState('');

  useEffect(() => {
    api('/api/session').then((data) => {
      setUser(data.user);
      if (data.user) api('/api/me/link').then(setMinecraftLink).catch(() => {});
    }).catch(() => {});
    api('/api/updates').then((data) => setUpdates(data.updates)).catch(() => {});
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      setUser(null);
      setAccountOpen(false);
      setLinkCode('');
      setToast('SESSION EXPIRED. PLEASE LOG IN AGAIN.');
    };
    window.addEventListener('cosmix:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('cosmix:auth-expired', handleExpiredSession);
  }, []);

  useEffect(() => {
    if (!linkExpiresAt) return undefined;
    const updateTimeLeft = () => {
      const seconds = Math.max(0, Math.ceil((linkExpiresAt - Date.now()) / 1000));
      setLinkTimeLeft(seconds);
      if (seconds === 0) {
        setLinkCode('');
        setLinkExpiresAt(0);
      }
    };
    updateTimeLeft();
    const timer = window.setInterval(updateTimeLeft, 1000);
    return () => window.clearInterval(timer);
  }, [linkExpiresAt]);

  useEffect(() => {
    if (!accountOpen || !user) return undefined;
    let active = true;
    const refreshLink = async () => {
      try {
        const status = await api('/api/me/link');
        if (!active) return;
        setMinecraftLink(status);
        if (status.linked) {
          setLinkCode('');
          setLinkExpiresAt(0);
        }
      } catch {
        if (active) setToast('COULD NOT REFRESH YOUR MINECRAFT LINK STATUS.');
      }
    };
    refreshLink();
    const timer = window.setInterval(refreshLink, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accountOpen, user]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(SERVER_ADDRESS);
      setCopied(true);
      setToast('SERVER ADDRESS COPIED');
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setToast(`SERVER ADDRESS: ${SERVER_ADDRESS}`);
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/api/${authMode === 'signup' ? 'signup' : 'login'}`, {
        method: 'POST', body: JSON.stringify(values),
      });
      const { user: activeUser } = await api('/api/session');
      if (!activeUser) {
        throw new Error('Login succeeded, but the browser did not keep the session cookie. Open the site over HTTPS and try again.');
      }
      setUser(activeUser);
      setAuthOpen(false);
      setToast(activeUser.role === 'admin' ? 'WELCOME IN. YOU’RE THE SITE ADMIN.' : `WELCOME TO THE SERVER, ${activeUser.username.toUpperCase()}.`);
      api('/api/me/link').then(setMinecraftLink).catch((error) => {
        setToast(`SIGNED IN, BUT ACCOUNT LINK STATUS FAILED: ${error.message || 'TRY AGAIN.'}`);
      });
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setAccountOpen(false);
    setLinkCode('');
    setToast('YOU’VE BEEN SIGNED OUT.');
  }

  async function openAccount() {
    setAccountOpen(true);
    setLinkCode('');
  }

  async function createMinecraftLinkCode() {
    setLinkBusy(true);
    try {
      const result = await api('/api/link-code', { method: 'POST' });
      setLinkCode(result.code);
      setLinkExpiresAt(result.expiresAt);
    } catch (error) {
      setToast(error.message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function unlinkMinecraftAccount() {
    if (!window.confirm('Unlink this Minecraft account from your Cosmix account?')) return;
    setLinkBusy(true);
    try {
      setMinecraftLink(await api('/api/me/link', { method: 'DELETE' }));
      setLinkCode('');
      setLinkExpiresAt(0);
      setToast('MINECRAFT ACCOUNT UNLINKED.');
    } catch (error) {
      setToast(error.message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function copyLinkCode() {
    try {
      await navigator.clipboard.writeText(linkCode);
      setToast('LINK CODE COPIED. USE /COSMIX LINK IN GAME.');
    } catch {
      setToast('ENTER THIS CODE IN GAME WITH /COSMIX LINK.');
    }
  }

  async function submitUpdate(event) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const file = form.elements.image.files[0];
    try {
      if (file) {
        const upload = new FormData();
        upload.append('image', file);
        values.image = (await api('/api/uploads', { method: 'POST', body: upload })).image;
      }
      const { update } = await api('/api/updates', { method: 'POST', body: JSON.stringify(values) });
      setUpdates((previous) => [update, ...previous]);
      form.reset();
      setImagePreview('');
      setToast('UPDATE IS LIVE.');
    } catch (error) {
      setToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeUpdate(update) {
    if (!window.confirm(`Remove “${update.title}”?`)) return;
    try {
      await api(`/api/updates/${update.id}`, { method: 'DELETE' });
      setUpdates((previous) => previous.filter((item) => item.id !== update.id));
      setToast('UPDATE REMOVED.');
    } catch (error) {
      setToast(error.message);
    }
  }

  function openAuth(mode) {
    setAuthMode(mode);
    setAuthOpen(true);
  }

  return <>
    <header className="nav">
      <a className="brand" href="#home" aria-label="Cosmix MC home"><span className="brand-mark"><span /></span><span className="brand-word">COSMIX<span>MC</span></span></a>
      <nav className={menuOpen ? 'nav-links nav-links-open' : 'nav-links'} aria-label="Main navigation">
        <a onClick={() => setMenuOpen(false)} href="#modes">GAME MODES</a><a onClick={() => setMenuOpen(false)} href="#updates">UPDATES</a><a onClick={() => setMenuOpen(false)} href="#plugins">PLUGINS</a>
      </nav>
      <div className="nav-actions">
        <button className="address-chip" onClick={copyAddress} title="Copy server address"><span className="live-dot" /> {SERVER_ADDRESS} <Copy size={14} /></button>
        {user ? <button className="account-button" onClick={openAccount} title="Account settings"><span className="account-avatar">{user.username.slice(0, 1).toUpperCase()}</span><UserRound size={15} /></button> : <button className="nav-login" onClick={() => openAuth('login')}>LOG IN <ArrowRight size={14} /></button>}
      </div>
      <button className="menu-toggle" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
    </header>

    <main>
      <section className="hero" id="home">
        <div className="hero-image" aria-hidden="true" /><div className="hero-grid" aria-hidden="true" />
        <div className="hero-content"><p className="eyebrow"><span className="eyebrow-line" /> MINECRAFT, WITH A LITTLE MORE AT STAKE</p>
          <h1>YOUR WORLD.<br /><span>YOUR RULES.</span></h1>
          <p className="hero-copy">Two ways to play. Countless ways to make it personal.<br className="desktop-break" /> Pick your mode and make the next move.</p>
          <div className="hero-actions"><a className="button button-lime" href="#modes">PICK YOUR MODE <ArrowRight size={17} /></a>{!user && <button className="button button-quiet" onClick={() => openAuth('signup')}>CREATE ACCOUNT <UserRound size={16} /></button>}</div>
          <div className="hero-online"><span className="live-dot" /><span>SERVER ADDRESS</span><button onClick={copyAddress}>{SERVER_ADDRESS} <Copy size={13} /></button>{copied && <span className="copied-label">COPIED</span>}</div>
        </div>
        <div className="hero-side-label">COSMIC BY NATURE. COMPETITIVE BY DESIGN.</div><a className="scroll-hint" href="#modes"><span>SCROLL TO EXPLORE</span><ArrowDown size={14} /></a><div className="hero-index"><span>01</span> / 03</div>
      </section>

      <section className="modes section-wrap" id="modes">
        <div className="section-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> FIND YOUR FIGHT</p><h2>TWO MODES.<br /><span>NO EASY WAY OUT.</span></h2></div><p className="section-aside">Same server. Different kind of pressure.<br />What are you in the mood for?</p></div>
        <div className="mode-grid">{games.map((game) => { const Icon = game.icon; return <article className={`mode-card mode-${game.tone}`} key={game.name}>
          <div className="mode-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-grid" /><span className="art-number">{game.number}</span><Icon className="mode-icon" strokeWidth={1.2} /><span className="art-caption">COSMIX / GAME MODE {game.number}</span></div>
          <div className="mode-info"><div className="mode-meta"><span>{game.tag}</span><span className="mode-status"><i /> {game.status}</span></div><h3>{game.name}</h3><p>{game.description}</p><button className="mode-link" onClick={copyAddress}>JOIN THIS MODE <ArrowRight size={16} /></button></div>
        </article>; })}</div>
      </section>

      <section className="updates-section" id="updates"><div className="section-wrap">
        <div className="section-heading updates-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> FROM THE SERVER</p><h2>FRESH OFF<br /><span>THE PRESS.</span></h2></div><p className="section-aside">New features, event announcements, and<br />what’s happening across Cosmix MC.</p></div>
        {user?.role === 'admin' && <form className="composer" onSubmit={submitUpdate}>
          <div className="composer-heading"><span className="composer-icon"><Sparkles size={16} /></span><div><strong>POST AN UPDATE</strong><small>Share what’s new with the server.</small></div><span className="admin-badge">ADMIN</span></div>
          <div className="composer-fields"><input name="title" placeholder="Update headline" required minLength="3" maxLength="100" aria-label="Update headline" /><textarea name="body" placeholder="Write your update..." rows="3" required maxLength="4000" aria-label="Update text" /></div>
          <div className="composer-footer"><label className="image-picker"><ImagePlus size={16} /> {imagePreview ? 'CHANGE IMAGE' : 'ADD IMAGE'}<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setImagePreview(event.target.files?.[0]?.name || '')} /></label><span className="image-name">{imagePreview}</span><button className="button button-lime publish-button" disabled={busy}>{busy ? 'PUBLISHING...' : 'PUBLISH UPDATE'} <ArrowRight size={16} /></button></div>
        </form>}
        {updates.length === 0 ? <div className="empty-updates"><span className="empty-mark"><Sparkles size={20} /></span><div><strong>THE NEXT BIG THING STARTS HERE.</strong><p>Server news and updates will show up here.</p></div></div> : <div className="update-grid">{updates.map((update, index) => <article className={`update-card ${index === 0 && update.image ? 'update-featured' : ''}`} key={update.id}>
          {update.image && <img className="update-image" src={update.image} alt="" />}
          <div className="update-content"><div className="update-topline"><span>SERVER UPDATE</span><time dateTime={update.created_at}>{new Date(update.created_at.includes('T') ? update.created_at : `${update.created_at.replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div><h3>{update.title}</h3><p>{update.body}</p><div className="update-byline"><span>POSTED BY {update.author.toUpperCase()}</span>{user?.role === 'admin' && <button aria-label={`Delete ${update.title}`} title="Delete update" onClick={() => removeUpdate(update)}><Trash2 size={15} /></button>}</div></div>
        </article>)}</div>}
      </div></section>

      <section className="plugins-section section-wrap" id="plugins">
        <div className="section-heading plugins-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> THE ENGINE ROOM</p><h2>THE STACK<br /><span>BEHIND THE PLAY.</span></h2></div><p className="section-aside">The tools that keep the world running<br />and every fight feeling fair.</p></div>
        <div className="plugin-list">{plugins.map((plugin, index) => { const Icon = plugin.icon; return <article className="plugin-row" key={plugin.name}><span className="plugin-index">0{index + 1}</span><span className={`plugin-icon icon-${plugin.color}`}><Icon size={18} strokeWidth={1.8} /></span><div className="plugin-name"><h3>{plugin.name}</h3><span>{plugin.category}</span></div><p>{plugin.description}</p><span className="plugin-status"><i /> {plugin.version}</span></article>; })}</div>
        <p className="plugin-footnote">Plugins and server features may change as Cosmix MC evolves.</p>
      </section>

      <section className="join-band"><div className="join-pattern" aria-hidden="true" /><div className="join-content"><div><p className="eyebrow"><span className="eyebrow-line" /> THE SERVER IS CALLING</p><h2>SEE YOU<br /><span>IN THERE.</span></h2></div><div className="join-cta"><button className="button button-lime" onClick={copyAddress}>{copied ? <><Check size={17} /> ADDRESS COPIED</> : <>COPY SERVER IP <Copy size={16} /></>}</button><span>JAVA EDITION <i /> {SERVER_ADDRESS}</span></div></div></section>
    </main>

    <footer className="footer"><a className="brand" href="#home"><span className="brand-mark"><span /></span><span className="brand-word">COSMIX<span>MC</span></span></a><span className="footer-note">A COMMUNITY SERVER. A WORLD OF YOUR OWN.</span><a className="back-top" href="#home">BACK TO TOP <ArrowDown size={14} /></a></footer>

    {authOpen && <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setAuthOpen(false)}><section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="modal-close" onClick={() => setAuthOpen(false)} aria-label="Close"><X size={19} /></button><span className="modal-mark"><span className="brand-mark"><span /></span></span><p className="eyebrow"><span className="eyebrow-line" /> YOUR PLACE IN THE WORLD</p><h2 id="auth-title">{authMode === 'signup' ? 'JOIN THE CREW.' : 'WELCOME BACK.'}</h2><p className="auth-intro">{authMode === 'signup' ? 'Create your Cosmix account and get in the game.' : 'Sign in and pick up where you left off.'}</p><form className="auth-form" onSubmit={submitAuth}>
      {authMode === 'signup' && <label>USERNAME<input name="username" type="text" placeholder="Your in-game name" minLength="3" maxLength="20" autoComplete="username" required /></label>}
      <label>EMAIL<input name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></label>
      <label>PASSWORD<input name="password" type="password" placeholder="At least 8 characters" minLength="8" maxLength="128" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required /></label>
      <button className="button button-lime auth-submit" disabled={busy}>{busy ? 'ONE SEC...' : authMode === 'signup' ? 'CREATE ACCOUNT' : 'LOG IN'} <ArrowRight size={16} /></button>
    </form><p className="auth-switch">{authMode === 'signup' ? 'Already have an account?' : 'New around here?'} <button onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}>{authMode === 'signup' ? 'Log in' : 'Create account'}</button></p></section></div>}
    {accountOpen && user && <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setAccountOpen(false)}><section className="auth-modal account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title"><button className="modal-close" onClick={() => setAccountOpen(false)} aria-label="Close"><X size={19} /></button><span className="modal-mark"><span className="brand-mark"><span /></span></span><p className="eyebrow"><span className="eyebrow-line" /> COSMIX ACCOUNT</p><h2 id="account-title">HEY, {user.username.toUpperCase()}.</h2><p className="auth-intro">Connect your Minecraft player to your website account.</p>
      <div className="minecraft-link-panel"><div className="minecraft-link-heading"><span className="minecraft-link-icon"><Link2 size={17} /></span><div><strong>MINECRAFT ACCOUNT</strong><small>{minecraftLink.linked ? 'LINKED TO COSMIX' : 'NOT LINKED YET'}</small></div><span className={`link-state ${minecraftLink.linked ? 'is-linked' : ''}`}><i /> {minecraftLink.linked ? 'LINKED' : 'NOT LINKED'}</span></div>
        {minecraftLink.linked ? <><div className="linked-player"><span className="player-avatar">{minecraftLink.minecraftUsername?.slice(0, 1).toUpperCase() || 'M'}</span><div><strong>{minecraftLink.minecraftUsername}</strong><small>{minecraftLink.minecraftUuid}</small></div></div><button className="unlink-button" onClick={unlinkMinecraftAccount} disabled={linkBusy}><Unlink size={15} /> UNLINK ACCOUNT</button></> : <><p className="link-explainer">Generate a one-time code, then enter it in Minecraft. Codes expire after 10 minutes.</p>{linkCode ? <div className="generated-code"><span>{linkCode}</span><button onClick={copyLinkCode} title="Copy link code" aria-label="Copy link code"><Copy size={17} /></button><small>EXPIRES IN {Math.floor(linkTimeLeft / 60)}:{String(linkTimeLeft % 60).padStart(2, '0')}</small></div> : <button className="button button-lime generate-code-button" onClick={createMinecraftLinkCode} disabled={linkBusy}>{linkBusy ? 'GENERATING...' : 'GENERATE LINK CODE'} <ArrowRight size={16} /></button>}<p className="link-command">IN GAME: <code>/cosmix link {linkCode || 'YOUR-CODE'}</code></p></>}
      </div><button className="account-logout" onClick={logout}><LogOut size={15} /> SIGN OUT</button></section></div>}
    {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button></div>}
  </>;
}

createRoot(document.getElementById('root')).render(<App />);