interface StepperProps {
  value: string;
  onChange: (next: string) => void;
  /** 步进值，默认 0.5（剂量常用粒度） */
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  ariaLabel: string;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 数字步进器：输入框 + 减/加按钮，对应小程序里的剂量加减控件 */
export function Stepper({
  value,
  onChange,
  step = 0.5,
  min = 0,
  max = 9999,
  placeholder,
  ariaLabel,
}: StepperProps) {
  const current = Number(value);
  const base = Number.isFinite(current) && value !== '' ? current : min;

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, round(base + delta)));
    onChange(String(next));
  };

  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-button"
        aria-label={`${ariaLabel}减少`}
        onClick={() => nudge(-step)}
        disabled={base <= min}
      >
        −
      </button>
      <input
        className="stepper-input"
        type="text"
        inputMode="decimal"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      <button
        type="button"
        className="stepper-button"
        aria-label={`${ariaLabel}增加`}
        onClick={() => nudge(step)}
        disabled={base >= max}
      >
        +
      </button>
    </div>
  );
}
