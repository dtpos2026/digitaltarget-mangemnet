import React from "react";

/**
 * Digital Target logo mark: four right-angled triangles on a 2×2 grid
 * (redrawn from the brand logo so it stays sharp at any size).
 */
export function BrandMark({ size = 32, color = "currentColor", className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 2 2" className={className} aria-hidden="true">
      <g fill={color}>
        <polygon points="0,0 1,0 1,1" />
        <polygon points="1,0 2,0 2,1" />
        <polygon points="0,1 1,1 1,2" />
        <polygon points="1,1 2,1 2,2" />
      </g>
    </svg>
  );
}

/** Mark + "DIGITAL TARGET" wordmark, as in the brand logo. */
export function BrandLogo({ size = 34, color = "#fff", subtitle }: { size?: number; color?: string; subtitle?: string }) {
  return (
    <div className="brandLogo" style={{ color }}>
      <BrandMark size={size} />
      <div className="brandWord">
        <b>DIGITAL<br />TARGET</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}

/** SVG markup of the mark for print windows / invoices (no React). */
export const BRAND_MARK_SVG = (color = "#fff", size = 40) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 2 2" xmlns="http://www.w3.org/2000/svg"><g fill="${color}"><polygon points="0,0 1,0 1,1"/><polygon points="1,0 2,0 2,1"/><polygon points="0,1 1,1 1,2"/><polygon points="1,1 2,1 2,2"/></g></svg>`;
