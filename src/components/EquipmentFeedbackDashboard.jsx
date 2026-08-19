import React, { useState } from "react";
import { ClipboardCheck, Star, Users, Wrench, MessageSquareQuote, TrendingUp } from "lucide-react";

const TABS = [
  { id: "equipment", label: "Equipment Feedback" },
  { id: "annual", label: "Annual Satisfaction Survey" },
];

// Static preview data only - no backend/survey source wired up yet (this
// whole dashboard is a mockup, per explicit request). Numbers are
// illustrative, not real submitted feedback.
const EQUIPMENT_FEEDBACK = {
  systemSatisfaction: 5.0,
  responses: 156,
  breakdown: [
    { label: "Reliability", value: 4.8 },
    { label: "Performance", value: 4.6 },
    { label: "Ease of Use", value: 4.9 },
  ],
  recent: [
    { name: "Somchai P.", comment: "ระบบทำงานเสถียรมาก ไม่มีปัญหาตั้งแต่ติดตั้ง", rating: 5 },
    { name: "Araya K.", comment: "แจ้งเตือนแม่นยำ ช่วยให้ดูแลแบตเตอรี่ได้ง่ายขึ้นเยอะ", rating: 5 },
    { name: "Wichai T.", comment: "อยากให้มีรายงานสรุปรายเดือนแบบ export ได้", rating: 4 },
  ],
};

const ANNUAL_SURVEY = {
  serviceSatisfaction: { responses: 248, avgPercent: 92 },
  responseRate: 78,
  breakdown: [
    { label: "Support Response Time", value: 90 },
    { label: "Communication", value: 94 },
    { label: "Issue Resolution", value: 91 },
  ],
};

function StarRating({ value, max = 5 }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => {
        const filled = i < Math.round(value);
        return (
          <Star
            key={i}
            className={`size-4 ${filled ? "fill-amber-400 text-amber-400" : "text-[var(--border)]"}`}
          />
        );
      })}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
      <div className="flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand-10)] text-[var(--brand)]">
          <Icon className="size-4" />
        </span>
        <p className="text-xs font-semibold text-[var(--muted-foreground)]">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-bold text-[var(--foreground)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted-foreground)]">{sub}</p>}
    </div>
  );
}

// Meter contract: fill carries the value, unfilled track is a lighter step
// of the same surface so the bar reads as one continuous scale.
function MeterRow({ label, value, unit = "" }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--foreground)]">{label}</span>
        <span className="font-semibold tabular-nums text-[var(--muted-foreground)]">
          {value}
          {unit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
          style={{ width: `${unit === "%" ? value : (value / 5) * 100}%` }}
        />
      </div>
    </div>
  );
}

function EquipmentFeedbackTab() {
  const d = EQUIPMENT_FEEDBACK;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--brand-10)] text-[var(--brand)]">
              <ClipboardCheck className="size-4" />
            </span>
            <p className="text-xs font-semibold text-[var(--muted-foreground)]">System Satisfaction</p>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <p className="text-3xl font-bold text-[var(--foreground)]">{d.systemSatisfaction.toFixed(2)}</p>
            <span className="text-xs text-[var(--muted-foreground)]">/ 5</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <StarRating value={d.systemSatisfaction} />
            <span className="text-xs text-[var(--muted-foreground)]">{d.responses} responses</span>
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
          <p className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">Rating Breakdown</p>
          <div className="space-y-3">
            {d.breakdown.map((b) => (
              <MeterRow key={b.label} label={b.label} value={b.value.toFixed(1)} unit="/5" />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
        <div className="mb-3 flex items-center gap-2">
          <MessageSquareQuote className="size-4 text-[var(--muted-foreground)]" />
          <p className="text-xs font-semibold text-[var(--muted-foreground)]">Recent Feedback</p>
        </div>
        <div className="space-y-2">
          {d.recent.map((r, i) => (
            <div key={i} className="rounded-xl bg-[var(--muted)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[var(--foreground)]">{r.name}</p>
                <StarRating value={r.rating} />
              </div>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">{r.comment}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AnnualSurveyTab() {
  const d = ANNUAL_SURVEY;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile
          icon={Users}
          label="Service Satisfaction"
          value={`${d.serviceSatisfaction.avgPercent}%`}
          sub={`${d.serviceSatisfaction.responses} responses this year`}
        />
        <StatTile icon={TrendingUp} label="Response Rate" value={`${d.responseRate}%`} sub="Of surveys sent this year" />
      </div>

      <div className="rounded-2xl bg-[var(--card)] p-4 shadow-sm ring-1 ring-[var(--border)]">
        <p className="mb-3 text-xs font-semibold text-[var(--muted-foreground)]">Category Breakdown</p>
        <div className="space-y-3">
          {d.breakdown.map((b) => (
            <MeterRow key={b.label} label={b.label} value={b.value} unit="%" />
          ))}
        </div>
      </div>
    </div>
  );
}

// Static mockup, per explicit request - no real survey/feedback backend
// wired up yet. Header + a tab switcher (Equipment Feedback / Annual
// Satisfaction Survey), each tab rendering its own set of stat tiles/
// meters from the mock data above.
export function EquipmentFeedbackDashboard() {
  const [tab, setTab] = useState("equipment");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-10)] text-[var(--brand)]">
          <Wrench className="size-5" />
        </span>
        <div>
          <h1 className="text-base font-semibold text-[var(--foreground)]">Equipment Feedback Dashboard</h1>
          <p className="text-xs text-[var(--muted-foreground)]">Real feedback insights at a glance</p>
        </div>
      </div>

      <div className="inline-flex items-center gap-1 rounded-xl bg-[var(--muted)] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? "bg-[var(--card)] text-[var(--brand)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "equipment" ? <EquipmentFeedbackTab /> : <AnnualSurveyTab />}
    </div>
  );
}
