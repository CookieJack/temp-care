import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

export type ToastType = 'info' | 'success' | 'error';

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastApi {
  /** 对应 wx.showToast：轻提示，自动消失 */
  show: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION = 1800;

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const show = useCallback((message: string, type: ToastType = 'info') => {
    if (typeof message !== 'string' || message.trim() === '') {
      return;
    }
    seqRef.current += 1;
    setToast({ id: seqRef.current, message, type });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    timerRef.current = window.setTimeout(() => setToast(null), DURATION);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [toast]);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <div key={toast.id} className={`toast toast-${toast.type}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 必须在 ToastProvider 内使用');
  }
  return context;
}
