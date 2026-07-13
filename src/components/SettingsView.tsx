import { useEffect, useState, FormEvent } from 'react';
import {
  User,
  Mail,
  Activity,
  Check,
  Palette,
  Server,
} from 'lucide-react';
import type { HealthInfo } from '../../shared/types.ts';

interface SettingsViewProps {
  devProfile: { name: string; email: string; avatar: string };
  setDevProfile: (profile: { name: string; email: string; avatar: string }) => void;
  /** Fetch live server/runtime health for the infrastructure panel. */
  onLoadHealth: () => Promise<HealthInfo>;
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function SettingsView({
  devProfile,
  setDevProfile,
  onLoadHealth
}: SettingsViewProps) {
  const [name, setName] = useState(devProfile.name);
  const [email, setEmail] = useState(devProfile.email);
  const [isSaved, setIsSaved] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    onLoadHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth(null));
    return () => {
      cancelled = true;
    };
  }, [onLoadHealth]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setDevProfile({
      name,
      email,
      avatar: devProfile.avatar
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-surface-container-lowest font-sans select-none">
      <div className="max-w-3xl mx-auto space-y-6">
        
        {/* Header Section */}
        <div>
          <h2 className="text-xl font-bold text-on-surface mb-1 flex items-center gap-3">
            Settings
          </h2>
          <p className="text-xs text-on-surface-variant font-mono">
            Your developer profile (used for commit attribution display), theme, and live API status.
          </p>
        </div>

        {/* Content Blocks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Main settings options */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Developer Identity Block */}
            <form onSubmit={handleSave} className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-xs font-mono font-bold text-outline uppercase flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                Developer Identity Card
              </h3>

              <div className="space-y-3 font-mono text-xs">
                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">Name</label>
                  <div className="flex items-center bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 focus-within:border-primary">
                    <User className="w-4 h-4 text-outline mr-2" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="bg-transparent border-none focus:ring-0 w-full p-0 text-on-surface focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-outline block mb-1 text-[10px] font-bold uppercase">Email Address</label>
                  <div className="flex items-center bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 focus-within:border-primary">
                    <Mail className="w-4 h-4 text-outline mr-2" />
                    <input
                      type="email"
                      value={email}
                      className="bg-transparent border-none focus:ring-0 w-full p-0 text-on-surface focus:outline-none"
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {isSaved ? (
                  <span className="text-secondary text-xs font-mono font-bold flex items-center gap-1.5 animate-pulse">
                    <Check className="w-4 h-4 text-secondary stroke-[3px]" />
                    Changes saved successfully!
                  </span>
                ) : (
                  <div></div>
                )}
                
                <button
                  type="submit"
                  className="bg-primary text-on-primary-container px-4 py-2 rounded-lg font-mono text-xs font-bold hover:opacity-90 active:scale-95 transition-all"
                >
                  Save Profile
                </button>
              </div>
            </form>

            {/* Theme — the app ships a single dark theme today. */}
            <div className="bg-surface-container-low border border-outline-variant rounded-xl p-5 space-y-4 shadow-sm font-mono text-xs text-on-surface-variant">
              <h3 className="text-xs font-bold text-outline uppercase flex items-center gap-2">
                <Palette className="w-4 h-4 text-tertiary" />
                Theme
              </h3>

              <div className="p-3 border border-primary rounded-lg bg-primary/5 flex items-center justify-between">
                <div>
                  <div className="font-bold text-on-surface mb-1">Obsidian Slate</div>
                  <div className="text-[10px] text-outline">Dark slate palette — the only theme for now.</div>
                </div>
                <Check className="w-4 h-4 text-primary shrink-0" />
              </div>
            </div>

          </div>

          {/* Infrastructure Health Card Panel */}
          <div className="space-y-4">
            
            <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 space-y-4 shadow-sm font-mono text-xs">
              <h3 className="text-[10px] font-bold text-outline uppercase flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-secondary" />
                API Server
              </h3>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Status</span>
                  {health ? (
                    <span className="text-secondary font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-secondary rounded-full animate-pulse"></span>
                      CONNECTED
                    </span>
                  ) : (
                    <span className="text-error font-bold">unreachable</span>
                  )}
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Bind</span>
                  <span className="text-on-surface font-semibold">
                    {health ? `${health.host}:${health.apiPort}` : '—'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Node</span>
                  <span className="text-on-surface font-semibold">{health?.node ?? '—'}</span>
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Platform</span>
                  <span className="text-on-surface font-semibold">
                    {health ? `${health.platform}/${health.arch}` : '—'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Uptime</span>
                  <span className="text-on-surface font-semibold">
                    {health ? formatUptime(health.uptimeSec) : '—'}
                  </span>
                </div>

                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-outline">Repos monitored</span>
                  <span className="text-on-surface font-semibold">{health?.repoCount ?? '—'}</span>
                </div>
              </div>
            </div>

            <div className="bg-primary-container/10 border border-primary/20 p-4 rounded-xl space-y-2 font-mono text-xs text-on-surface-variant leading-relaxed">
              <div className="flex items-center gap-1 text-primary font-bold">
                <Server className="w-4 h-4 text-primary" />
                <span>Local API</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                The API binds to loopback only ({health?.host ?? '127.0.0.1'}) and shells out to <span className="text-secondary">git</span> on
                your machine. It is unauthenticated by design — keep it bound to localhost.
              </p>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
