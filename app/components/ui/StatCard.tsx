/**
 * StatCard 组件
 * 用于显示统计数据，如 GMV、订单数等
 */

export interface StatCardProps {
  label: string;
  value: string | number;
  color?: string;
  subtitle?: string;
}

export function StatCard({ label, value, color = "#212b36", subtitle }: StatCardProps) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: 28,
          fontWeight: "bold",
          color,
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 13,
          color: "#637381",
          marginTop: 4,
        }}
      >
        {label}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 11,
            color: "#919eab",
            marginTop: 2,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
