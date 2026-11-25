import { useId } from 'react';

interface MdFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'text' | 'decimal' | 'numeric';
  maxLength?: number;
  big?: boolean;
  suffix?: string;
}

/** MD Filled 文本输入：标签常驻顶部，输入区在标签下方（对应小程序 md-field） */
export function MdField({
  label,
  value,
  onChange,
  placeholder,
  inputMode = 'text',
  maxLength,
  big = false,
  suffix,
}: MdFieldProps) {
  const id = useId();

  return (
    <div className={big ? 'md-field md-field-big' : 'md-field'}>
      <label className="md-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="md-input"
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
      {suffix ? <span className="md-field-suffix">{suffix}</span> : null}
    </div>
  );
}

interface DateTimeFieldProps {
  label: string;
  type: 'date' | 'time';
  value: string;
  onChange: (value: string) => void;
}

/** 日期 / 时间选择：沿用 md-field 外观，交给浏览器原生选择器 */
export function DateTimeField({ label, type, value, onChange }: DateTimeFieldProps) {
  const id = useId();

  return (
    <div className="md-field md-field-disabled">
      <label className="md-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="md-input"
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}

interface MdTextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
}

/** MD Filled 多行输入（对应小程序 md-area） */
export function MdTextArea({ label, value, onChange, placeholder, maxLength }: MdTextAreaProps) {
  const id = useId();

  return (
    <div className="md-area">
      <label className="md-area-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="md-area-textarea"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}
