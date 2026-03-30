export default function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
