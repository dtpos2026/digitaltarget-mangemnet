import React from "react";
import { useData } from "@/contexts/DataContext";
import { businessesOf, setBusinessUnit, useBusinessUnit } from "@/lib/business";

/** "All | 💻 Software | 📣 Digital Marketing …" — the business being worked on (shared across Sales, Products, Team). */
export default function BusinessSwitcher({ only }: { only?: string[] }) {
  const { data } = useData();
  const unit = useBusinessUnit();
  const units = businessesOf(data.settings).filter((b) => !only?.length || only.includes(b.id));
  if (units.length < 2) return null;
  return (
    <div className="segmented bizSwitch" role="tablist" aria-label="Business">
      <button className={!unit ? "on" : ""} onClick={() => setBusinessUnit("")}>Sab businesses</button>
      {units.map((b) => (
        <button key={b.id} className={unit === b.id ? "on" : ""} onClick={() => setBusinessUnit(b.id)} style={unit === b.id ? { borderColor: b.color } : undefined}>
          {b.icon} {b.name}
        </button>
      ))}
    </div>
  );
}
