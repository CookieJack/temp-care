interface ChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
}

/** 药名快捷芯片等场景：可选中态 + 触控反馈 */
export function Chip({ label, selected = false, onClick }: ChipProps) {
  return (
    <button
      type="button"
      className={selected ? 'chip is-selected' : 'chip'}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
