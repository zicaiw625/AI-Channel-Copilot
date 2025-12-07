/**
 * ProgressBar 组件
 * 显示进度条，支持渐变色
 */

export interface ProgressBarProps {
  value: number;
  max?: number;
  height?: number;
  gradient?: string;
  showLabel?: boolean;
  label?: string;
}

export function ProgressBar({
  value,
  max = 100,
  height = 8,
  gradient = "linear-gradient(90deg, #008060, #00a2ff)",
  showLabel = false,
  label,
}: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <div>
      <div
        style={{
          background: "#e1e3e5",
          borderRadius: height / 2,
          height,
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div
          style={{
            width: `${percentage}%`,
            height: "100%",
            background: gradient,
            borderRadius: height / 2,
            transition: "width 0.5s ease",
          }}
        />
      </div>
      {showLabel && (
        <div
          style={{
            fontSize: 12,
            color: "#637381",
            marginTop: 4,
            textAlign: "center",
          }}
        >
          {label || `${percentage.toFixed(1)}%`}
        </div>
      )}
    </div>
  );
}
