import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

export interface ConfirmOptions {
  title: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮用 error 色 */
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: PropsWithChildren) {
  const [dialog, setDialog] = useState<ConfirmState | null>(null);
  const dialogRef = useRef<ConfirmState | null>(null);

  const confirm = useCallback<ConfirmFn>(options => {
    return new Promise<boolean>(resolve => {
      // 同一时刻只保留一个确认框：旧的按取消处理
      dialogRef.current?.resolve(false);
      const next = { ...options, resolve };
      dialogRef.current = next;
      setDialog(next);
    });
  }, []);

  const close = useCallback((confirmed: boolean) => {
    const current = dialogRef.current;
    dialogRef.current = null;
    setDialog(null);
    current?.resolve(confirmed);
  }, []);

  useEffect(() => {
    if (!dialog) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog ? (
        <div className="overlay" role="presentation">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={dialog.content ? 'confirm-content' : undefined}
          >
            <h2 className="dialog-title" id="confirm-title">
              {dialog.title}
            </h2>
            {dialog.content ? (
              <p className="dialog-content" id="confirm-content">
                {dialog.content}
              </p>
            ) : null}
            <div className="dialog-actions">
              <button type="button" className="dialog-button dialog-cancel" onClick={() => close(false)} autoFocus>
                {dialog.cancelText ?? '取消'}
              </button>
              <button
                type="button"
                className={dialog.danger ? 'dialog-button dialog-confirm is-danger' : 'dialog-button dialog-confirm'}
                onClick={() => close(true)}
              >
                {dialog.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error('useConfirm 必须在 ConfirmProvider 内使用');
  }
  return context;
}
