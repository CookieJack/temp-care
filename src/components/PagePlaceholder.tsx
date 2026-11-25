interface PagePlaceholderProps {
  eyebrow: string;
  title: string;
  phase: string;
  description: string;
}

/** P0 页面骨架：仅保留页头与占位说明，业务实现按阶段替换 */
export function PagePlaceholder({ eyebrow, title, phase, description }: PagePlaceholderProps) {
  return (
    <main className="page">
      <header className="md-head">
        <p className="md-head-eyebrow">{eyebrow}</p>
        <h1 className="md-head-title">{title}</h1>
      </header>
      <section className="state-card">
        <p className="state-title">页面骨架已就绪</p>
        <p className="state-description">{description}</p>
        <p className="skeleton-note">计划于 {phase} 实现</p>
      </section>
    </main>
  );
}
