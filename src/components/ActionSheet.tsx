import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';

export interface ActionSheetItem {
  key: string;
  label: string;
  description?: string;
  danger?: boolean;
}

export interface ActionSheetOptions {
  title?: string;
  items: ActionSheetItem[];
  cancelText?: string;
}

interface SheetState extends ActionSheetOptions {
  resolve: (key: string | null) => void;
}

/** 对应 wx.showActionSheet：返回选中项 key，取消返回 null */
type ShowSheet = (options: ActionSheetOptions) => Promise<string | null>;

const ActionSheetContext = createContext<ShowSheet | null>(null);

export function ActionSheetProvider({ children }: PropsWithChildren) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const sheetRef = useRef<SheetState | null>(null);

  const showSheet = useCallback<ShowSheet>(options => {
    return new Promise<string | null>(resolve => {
      sheetRef.current?.resolve(null);
      const next = { ...options, resolve };
      sheetRef.current = next;
      setSheet(next);
    });
  }, []);

  const close = useCallback((key: string | null) => {
    const current = sheetRef.current;
    sheetRef.current = null;
    setSheet(null);
    current?.resolve(key);
  }, []);

  useEffect(() => {
    if (!sheet) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheet, close]);

  return (
    <ActionSheetContext.Provider value={showSheet}>
      {children}
      {sheet ? (
        <div className="overlay overlay-sheet" role="presentation" onClick={() => close(null)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheet.title ?? '选择操作'}
            onClick={event => event.stopPropagation()}
          >
            {sheet.title ? <p className="sheet-title">{sheet.title}</p> : null}
            <div className="sheet-list">
              {sheet.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={item.danger ? 'sheet-item is-danger' : 'sheet-item'}
                  onClick={() => close(item.key)}
                >
                  <span className="sheet-item-label">{item.label}</span>
                  {item.description ? <span className="sheet-item-desc">{item.description}</span> : null}
                </button>
              ))}
            </div>
            <button type="button" className="sheet-cancel" onClick={() => close(null)}>
              {sheet.cancelText ?? '取消'}
            </button>
          </div>
        </div>
      ) : null}
    </ActionSheetContext.Provider>
  );
}

export function useActionSheet(): ShowSheet {
  const context = useContext(ActionSheetContext);
  if (!context) {
    throw new Error('useActionSheet 必须在 ActionSheetProvider 内使用');
  }
  return context;
}
