"use client";

import { useEffect, useState, useCallback } from "react";

interface Item {
  id: string;
  rowIndex: number;
  field: string;
  rawValue: string | null;
  suggestedValue: string | null;
  confidence: number;
  cropBox: { x: number; y: number; w: number; h: number } | null;
}
interface Group {
  image: { id: string; url: string; docType: string; note: string | null };
  items: Item[];
}

export default function ReviewPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [cat, setCat] = useState<any>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      fetch("/api/review").then((x) => x.json()),
      fetch("/api/catalogue").then((x) => x.json()),
    ]);
    setGroups(r.groups);
    setTotal(r.totalPending);
    setCat(c);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(item: Item, action: "approve" | "correct" | "reject") {
    setBusy(true);
    try {
      const value = action === "correct" ? edits[item.id] ?? item.suggestedValue ?? "" : undefined;
      await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, action, value }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function approveAll(imageId: string) {
    setBusy(true);
    try {
      await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageId, approveAll: true }) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
          <p className="text-sm text-muted">Only the uncertain fields — not a re-typing of the page. Every correction trains the reader.</p>
        </div>
        <span className="pill bg-warn/20 text-warn">{total} fields pending</span>
      </div>

      {groups.length === 0 && (
        <div className="card text-sm text-muted">
          Queue is clear. Anything you correct here commits to the canonical store and becomes a few-shot example, so
          re-uploading the same page type shows higher auto-approval next time.
        </div>
      )}

      {groups.map((g) => (
        <div key={g.image.id} className="card">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="pill bg-accent/20 text-accent">{g.image.docType}</span>
              {g.image.note && <span className="text-xs text-muted">{g.image.note}</span>}
            </div>
            <button className="btn" disabled={busy} onClick={() => approveAll(g.image.id)}>
              Approve all suggestions
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Source photo with crop highlight */}
            <div className="relative overflow-hidden rounded-lg border border-edge bg-black/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.image.url} alt="source page" className="w-full" />
              {(() => {
                const focused = g.items.find((i) => i.id === focus) ?? g.items[0];
                const box = focused?.cropBox;
                if (!box) return null;
                return (
                  <div
                    className="pointer-events-none absolute border-2 border-accent bg-accent/10"
                    style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                  />
                );
              })()}
            </div>

            {/* Editable fields */}
            <div className="space-y-3">
              {g.items.map((item) => (
                <div
                  key={item.id}
                  className={`rounded-lg border p-3 ${focus === item.id ? "border-accent" : "border-edge"}`}
                  onMouseEnter={() => setFocus(item.id)}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-medium">
                      row {item.rowIndex + 1} · <span className="text-accent">{item.field}</span>
                    </span>
                    <span className={`pill ${item.confidence < 0.6 ? "bg-bad/20 text-bad" : "bg-warn/20 text-warn"}`}>
                      {Math.round(item.confidence * 100)}% sure
                    </span>
                  </div>
                  {item.rawValue && <div className="mb-2 text-xs text-muted">read: “{item.rawValue}”</div>}
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="input flex-1"
                      list={item.field === "product" ? "variants" : undefined}
                      defaultValue={item.suggestedValue ?? ""}
                      onChange={(e) => setEdits((s) => ({ ...s, [item.id]: e.target.value }))}
                    />
                    <button className="btn btn-primary" disabled={busy} onClick={() => resolve(item, "approve")}>
                      ✓ Accept
                    </button>
                    <button className="btn" disabled={busy} onClick={() => resolve(item, "correct")}>
                      ✎ Save edit
                    </button>
                    <button className="btn" disabled={busy} onClick={() => resolve(item, "reject")} title="Drop this field">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <datalist id="variants">
        {cat?.variants?.map((v: any) => (
          <option key={v.id} value={v.label}>
            {v.product} · {v.sellPrice} {`AMD`}
          </option>
        ))}
      </datalist>
    </div>
  );
}
