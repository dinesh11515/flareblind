export function BrandMark({ size = 38, tone = "accent" }: { size?: number; tone?: "accent" | "sage" | "reversed" }) {

  const t = {
    accent:   { plate: "var(--accent-dim)", ink: "var(--accent)",  slat: "var(--bg)" },
    sage:     { plate: "#ccdbb2",           ink: "#56633f",        slat: "#f0fae1"   },
    reversed: { plate: "#643312",           ink: "#f6a06b",        slat: "#2e2b25"   },
  }[tone];

  const id = `fb-clip-${tone}`;

  return (
    <svg className="brand-mark" viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <circle cx="20" cy="20" r="20" fill={t.plate} />
        <g stroke={t.ink} strokeWidth="2.75" strokeLinecap="round" fill="none">
          <path d="M20 4.2v4.1M20 31.7v4.1M4.2 20h4.1M31.7 20h4.1M8.9 8.9l2.9 2.9M28.2 28.2l2.9 2.9M31.1 8.9l-2.9 2.9M11.8 28.2l-2.9 2.9" />
        </g>
        <circle cx="20" cy="20" r="7.6" fill={t.ink} />
        <g fill={t.slat}>
          <rect x="-1" y="14.1" width="42" height="3.5" rx="1.75" />
          <rect x="-1" y="22.4" width="42" height="3.5" rx="1.75" />
        </g>
      </g>
    </svg>
  );
}
