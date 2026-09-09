import type {ReactNode} from 'react';

export function SettingsSection({title, description, children}: {title: string; description?: string; children: ReactNode}) {
  return <section className="settings-section"><div className="settings-section__heading"><h3>{title}</h3>{description && <p>{description}</p>}</div>{children}</section>;
}
