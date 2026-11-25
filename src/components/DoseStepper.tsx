interface DoseStepperProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}

/**
 * 剂量步进器：移植 record.js / batch-detail.js 的步进语义。
 * ±1；空值按 + 从 1 起；减到 0 视为未记录（回填空串）；上限 10000。
 */
export function DoseStepper({ value, onChange, ariaLabel }: DoseStepperProps) {
  const step = (op: 'plus' | 'minus') => {
    const current = Number(value);
    let next = Number.isFinite(current) && current > 0 ? current : 0;
    if (op === 'plus') {
      next += 1;
      if (next > 10000) {
        next = 10000;
      }
    } else {
      next -= 1;
    }
    onChange(next >= 1 ? String(next) : '');
  };

  return (
    <div className="md-stepper">
      <button
        type="button"
        className="md-stepper-btn"
        aria-label={`${ariaLabel}减少`}
        onClick={() => step('minus')}
      >
        −
      </button>
      <input
        className="md-stepper-input"
        type="text"
        inputMode="decimal"
        placeholder="选填"
        aria-label={ariaLabel}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      <button
        type="button"
        className="md-stepper-btn"
        aria-label={`${ariaLabel}增加`}
        onClick={() => step('plus')}
      >
        +
      </button>
    </div>
  );
}
