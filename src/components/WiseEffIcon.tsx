import { useId, type SVGProps } from "react";

type WiseEffIconVariant = "full" | "favicon" | "mono";

type WiseEffIconProps = Omit<SVGProps<SVGSVGElement>, "role"> & {
  decorative?: boolean;
  title?: string;
  variant?: WiseEffIconVariant;
};

export function WiseEffIcon({
  decorative = false,
  title = "雷泽图标",
  variant = "full",
  className,
  ...props
}: WiseEffIconProps) {
  const classes = ["wiseeff-icon", `wiseeff-icon-${variant}`, className].filter(Boolean).join(" ");
  const gradientId = useId();
  const backgroundGradientId = `wiseeff-component-bg-${gradientId}`;
  const boltGradientId = `wiseeff-component-bolt-${gradientId}`;
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
          className="wiseeff-icon-bolt"
          d="M22.8 5.9L10.2 19.3H18L13.8 32.2L30.1 14.2H21.5L22.8 5.9Z"
          fill="#FFFFFF"
        />
        <path
          className="wiseeff-icon-marsh-wave-primary"
          d="M8 28.1C12.3 25.7 16.6 25.7 20.9 28.1C24.7 30.2 28 30.3 32 28.7"
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.58"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
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
          className="wiseeff-icon-bolt"
          d="M148 43L83 127H122L100 194L184 91H139L148 43Z"
          fill="currentColor"
        />
        <path
          className="wiseeff-icon-marsh-wave-primary"
          d="M73 176C96 163 119 163 142 176C160 186 177 188 196 180"
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          className="wiseeff-icon-marsh-wave-secondary"
          d="M69 199C96 184 124 184 151 199C169 208 185 210 201 203"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 260 260" className={classes} {...props} {...accessibilityProps}>
      {!decorative ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={backgroundGradientId} x1="24" y1="22" x2="236" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#002F87" />
          <stop offset="0.5" stopColor="#0052CC" />
          <stop offset="1" stopColor="#00978F" />
        </linearGradient>
        <linearGradient id={boltGradientId} x1="95" y1="42" x2="178" y2="193" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#57E4FF" />
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
        className="wiseeff-icon-bolt"
        d="M148 43L83 127H122L100 194L184 91H139L148 43Z"
        fill={`url(#${boltGradientId})`}
      />
      <path
        className="wiseeff-icon-bolt-highlight"
        d="M148 43L83 127H122L100 194L184 91H139L148 43Z"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.2"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <path
        className="wiseeff-icon-marsh-wave-primary"
        d="M73 176C96 163 119 163 142 176C160 186 177 188 196 180"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.5"
        strokeWidth="9"
        strokeLinecap="round"
      />
      <path
        className="wiseeff-icon-marsh-wave-secondary"
        d="M69 199C96 184 124 184 151 199C169 208 185 210 201 203"
        fill="none"
        stroke="#50DCFF"
        strokeOpacity="0.86"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        className="wiseeff-icon-marsh-wave-tertiary"
        d="M91 219C113 211 135 211 157 220"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.36"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
