import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}

/** 表单字段外壳：标签 + 控件 + 提示，与小程序页面里「字段标题 + 输入框」结构一致 */
export function Field({ label, htmlFor, required = false, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? <span className="field-required"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}
