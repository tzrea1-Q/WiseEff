import { MAIN_CONTENT_ID } from "./landmarks";
import "./skip-link.css";

export function SkipLink({
  href = `#${MAIN_CONTENT_ID}`,
  label = "跳到主内容"
}: {
  href?: string;
  label?: string;
}) {
  return (
    <a className="skip-link" href={href}>
      {label}
    </a>
  );
}
