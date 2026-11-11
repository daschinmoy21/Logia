import type { ReactNode } from 'react';
import { Cloud, HardDrive, Info, Monitor, Moon, Sun } from 'lucide-react';
import { useMobileStore, type TextSize, type ThemePreference } from './mobileStore';
import { Segmented } from './ui';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="px-[calc(20px+var(--m-safe-left))] pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-m-faint">{title}</h2>
      <div className="mx-[calc(12px+var(--m-safe-left))] overflow-hidden rounded-2xl bg-m-surface ring-1 ring-m-line/70">{children}</div>
    </section>
  );
}

function Row({ icon, title, detail, trailing }: { icon: ReactNode; title: string; detail?: string; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-m-fill text-m-muted" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-base text-m-text">{title}</span>
        {detail && <span className="mt-0.5 block text-[13.5px] leading-snug text-m-muted">{detail}</span>}
      </span>
      {trailing}
    </div>
  );
}

const THEMES: Array<{ value: ThemePreference; label: string; icon: ReactNode }> = [
  { value: 'system', label: 'System', icon: <Monitor size={16} aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun size={16} aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={16} aria-hidden="true" /> },
];

const SIZES: Array<{ value: TextSize; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
];

export function SettingsScreen() {
  const theme = useMobileStore((s) => s.theme);
  const textSize = useMobileStore((s) => s.textSize);
  const setTheme = useMobileStore((s) => s.setTheme);
  const setTextSize = useMobileStore((s) => s.setTextSize);

  return (
    <div className="m-chrome flex h-full flex-col">
      <header className="flex-shrink-0 pt-(--m-safe-top)">
        <div className="flex h-12 items-center px-[calc(16px+var(--m-safe-left))]">
          <h1 className="text-[22px] font-bold tracking-[-0.015em]">Settings</h1>
        </div>
      </header>
      <div className="m-scroll min-h-0 flex-1" style={{ paddingBottom: 'calc(var(--m-nav-h) + var(--m-safe-bottom) + 24px)' }}>

        <Group title="Appearance">
          <div className="px-4 pb-4 pt-4">
            <p className="mb-2.5 text-base">Theme</p>
            <Segmented label="Theme" value={theme} options={THEMES} onChange={setTheme} />
          </div>
          <div className="border-t border-m-line/70 px-4 pb-4 pt-4">
            <p className="mb-2.5 text-base">Text size</p>
            <Segmented label="Text size" value={textSize} options={SIZES} onChange={setTextSize} />
            <p className="mt-3 text-m-muted" style={{ fontSize: 'var(--m-editor-size)' }}>Notes are shown at this size.</p>
          </div>
        </Group>

        <Group title="Sync">
          <Row
            icon={<Cloud size={19} />}
            title="Sync across devices"
            detail="Keep notes the same on your phone and computer."
            trailing={<span className="flex-shrink-0 rounded-full bg-m-fill px-2.5 py-1 text-[12.5px] font-semibold text-m-muted">Coming soon</span>}
          />
          <div className="border-t border-m-line/70">
            <Row icon={<HardDrive size={19} />} title="Stored on this device" detail="Notes and tasks are saved locally as you type." />
          </div>
        </Group>

        <Group title="About">
          <Row icon={<Info size={19} />} title="Logia" detail={`Version ${__APP_VERSION__}`} />
        </Group>
      </div>
    </div>
  );
}
