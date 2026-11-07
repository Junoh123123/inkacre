export function AppMark({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <img className={`app-mark${className ? ` ${className}` : ''}`} src="/app/favicon.svg" width={size} height={size} alt="" draggable={false} />
  );
}
