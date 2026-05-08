import { useId, type SVGProps } from "react";

type WiseEffIconVariant = "full" | "favicon" | "mono";

type WiseEffIconProps = Omit<SVGProps<SVGSVGElement>, "role"> & {
  decorative?: boolean;
  title?: string;
  variant?: WiseEffIconVariant;
};

export function WiseEffIcon({
  decorative = false,
  title = "WiseEff icon",
  variant = "full",
  className,
  ...props
}: WiseEffIconProps) {
  const classes = ["wiseeff-icon", `wiseeff-icon-${variant}`, className].filter(Boolean).join(" ");
  const gradientId = useId();
  const backgroundGradientId = `wiseeff-component-bg-${gradientId}`;
  const pathGradientId = `wiseeff-component-path-${gradientId}`;
  const accessibilityProps = decorative
    ? { "aria-hidden": true }
    : {
        role: "img",
        "aria-label": title
      };

  if (variant === "favicon") {
    return (
      <svg viewBox="0 0 40 40" className={classes} {...props} {...accessibilityProps}>
        {!decorative ? <title>{title}</title> : null}
        <rect className="wiseeff-icon-container" width="40" height="40" rx="10" fill="#003D9B" />
        <path
          className="wiseeff-icon-path"
          d="M8 16C10 28 14 31 17 30C20 29 20 18 23 17C27 15 27 30 31 29C34 29 35 22 36 14"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <circle className="wiseeff-icon-node-primary" cx="23" cy="17" r="2.3" fill="#50DCFF" />
      </svg>
    );
  }

  if (variant === "mono") {
    return (
      <svg viewBox="0 0 260 260" className={classes} {...props} {...accessibilityProps}>
        {!decorative ? <title>{title}</title> : null}
        <rect
          className="wiseeff-icon-container"
          x="30"
          y="30"
          width="200"
          height="200"
          rx="48"
          fill="none"
          stroke="currentColor"
          strokeWidth="14"
        />
        <path
          className="wiseeff-icon-path"
          d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
          fill="none"
          stroke="currentColor"
          strokeWidth="22"
          strokeLinecap="round"
        />
        <circle className="wiseeff-icon-node-primary" cx="138" cy="118" r="10" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 260 260" className={classes} {...props} {...accessibilityProps}>
      {!decorative ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={backgroundGradientId} x1="24" y1="22" x2="236" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#003D9B" />
          <stop offset="0.56" stopColor="#0052CC" />
          <stop offset="1" stopColor="#00687B" />
        </linearGradient>
        <linearGradient id={pathGradientId} x1="60" y1="106" x2="202" y2="158" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="0.58" stopColor="#E9F9FF" />
          <stop offset="1" stopColor="#50DCFF" />
        </linearGradient>
      </defs>
      <rect
        className="wiseeff-icon-container"
        x="30"
        y="30"
        width="200"
        height="200"
        rx="48"
        fill={`url(#${backgroundGradientId})`}
      />
      <path
        className="wiseeff-icon-path"
        d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
        fill="none"
        stroke={`url(#${pathGradientId})`}
        strokeWidth="22"
        strokeLinecap="round"
      />
      <path
        className="wiseeff-icon-path-highlight"
        d="M59 112C70 164 82 188 102 184C119 181 118 127 138 118C161 108 156 181 176 180C197 179 204 136 208 94"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.24"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle className="wiseeff-icon-node-primary" cx="138" cy="118" r="10" fill="#50DCFF" />
      <circle className="wiseeff-icon-node-secondary" cx="176" cy="180" r="7" fill="#FFFFFF" />
      <path
        className="wiseeff-icon-spark"
        d="M184 58L190 73L205 79L190 85L184 100L178 85L163 79L178 73Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}
