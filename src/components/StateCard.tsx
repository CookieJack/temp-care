import { Button } from './Button';

interface StateCardProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** 页面状态卡：与小程序 state-card 的 loading / empty / error 三种形态对齐 */
export function StateCard({ kind, title, description, actionLabel, onAction }: StateCardProps) {
  const isError = kind === 'error';

  return (
    <section className={isError ? 'state-card state-card-error' : 'state-card'}>
      {kind === 'loading' ? <div className="spinner" /> : null}
      {kind === 'empty' ? <p className="state-icon">○</p> : null}
      {isError ? <p className="state-icon">!</p> : null}
      <p className="state-title">{title}</p>
      {description ? <p className="state-description">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button className="state-action" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </section>
  );
}
