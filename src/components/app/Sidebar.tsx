import React from "react";

interface Tab {
  id: string;
  label: string;
  countKey: string;
}

interface Props {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  getCount: (key: string) => string | number;
}

export default function Sidebar({ tabs, activeTab, onTabChange, getCount }: Props) {
  return (
    <aside className="sidebar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`navbtn ${activeTab === tab.id ? "active" : ""}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span>{tab.label}</span>
          <span className="count">{getCount(tab.countKey)}</span>
        </button>
      ))}
    </aside>
  );
}