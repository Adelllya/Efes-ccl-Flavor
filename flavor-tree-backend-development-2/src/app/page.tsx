"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FlavorNote {
  id: string;
  name: string;
  technicalTerm: string | null;
  wheelCode: string | null;
  category: "TOP" | "HEART" | "BASE";
  categoryLabel: string;
  description: string;
  icon: string;
  referenceMaterial: string | null;
  isOffFlavour: boolean;
}

interface Brand {
  id: string;
  name: string;
  brandOwner: string;
  style: string;
  abv: number;
  density: string | null;
  fermentationType: string | null;
  description: string;
  image: string;
  isActive: boolean;
  noteCount?: number;
  profile?: {
    top: number;
    heart: number;
    base: number;
    total: number;
    complete: boolean;
    status: "complete" | "partial" | "empty";
  };
  servingRecommendation?: {
    servingTempMin: number;
    servingTempMax: number;
    glassType: string;
    seasonality: string | null;
  } | null;
}

interface PyramidNote {
  id: string;
  name: string;
  icon: string;
  description: string;
  technicalTerm: string | null;
  referenceMaterial: string | null;
  isOffFlavour: boolean;
  intensity: number;
  sommelierNote: string | null;
  sommelierName: string | null;
  categoryLabel: string;
}

interface Pyramid {
  brand: string;
  brandId: string;
  top: PyramidNote[];
  heart: PyramidNote[];
  base: PyramidNote[];
}

interface Course {
  id: string;
  level: number;
  title: string;
  description: string;
  color: string;
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  bio: string;
  avatar: string | null;
}

interface LandingData {
  project: {
    name: string;
    tagline: string;
    description: string;
    partner: string;
    market: string;
  };
  quote: { text: string; author: string };
  stats: {
    brands: number;
    flavorNotes: number;
    flavorProfiles: number;
    courses: number;
    teamMembers: number;
  };
  courses: Course[];
  team: TeamMember[];
  pyramidLayers: { key: string; label: string; time: string; color: string }[];
}

type Tab = "admin" | "catalog" | "courses" | "team" | "api";

interface EditorRow {
  flavorNoteId: string;
  intensity: number;
  sommelierNote: string;
}

// ─── Layer config ────────────────────────────────────────────────────────────

const LAYERS = {
  TOP: {
    label: "Top Notes",
    sub: "Первое впечатление · 0–3 сек",
    gradient: "from-yellow-300 to-amber-400",
    border: "border-amber-400",
    bg: "bg-amber-50",
    text: "text-amber-900",
    badge: "bg-amber-400 text-amber-950",
    note: "bg-yellow-100 border-yellow-300",
  },
  HEART: {
    label: "Heart Notes",
    sub: "Основное тело · 3–15 сек",
    gradient: "from-amber-700 to-amber-900",
    border: "border-amber-700",
    bg: "bg-amber-950/10",
    text: "text-amber-950",
    badge: "bg-amber-700 text-amber-50",
    note: "bg-amber-100 border-amber-400",
  },
  BASE: {
    label: "Base Notes",
    sub: "Послевкусие · 15+ сек",
    gradient: "from-stone-800 to-stone-950",
    border: "border-stone-800",
    bg: "bg-stone-900/10",
    text: "text-stone-900",
    badge: "bg-stone-800 text-stone-50",
    note: "bg-stone-100 border-stone-400",
  },
} as const;

// ─── API helpers ─────────────────────────────────────────────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab] = useState<Tab>("admin");
  const [landing, setLanding] = useState<LandingData | null>(null);
  const [seeded, setSeeded] = useState<boolean | null>(null);

  useEffect(() => {
    api<LandingData>("/landing")
      .then((d) => {
        setLanding(d);
        setSeeded(d.stats.brands > 0);
      })
      .catch(() => setSeeded(false));
  }, []);

  const handleSeed = useCallback(async () => {
    setSeeded(null);
    try {
      await api("/seed");
      const d = await api<LandingData>("/landing");
      setLanding(d);
      setSeeded(d.stats.brands > 0);
    } catch {
      setSeeded(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-50 to-stone-100 text-stone-900">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-amber-900/10 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-amber-800 text-xl shadow-md">
              🍺
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight">
                Flavor Tree
              </h1>
              <p className="text-[11px] leading-tight text-stone-500">
                Don&apos;t just drink — listen to the flavor
              </p>
            </div>
          </div>

          {landing && (
            <div className="hidden items-center gap-4 text-xs text-stone-500 md:flex">
              <span>
                <b className="text-stone-800">{landing.stats.brands}</b> сортов
              </span>
              <span>
                <b className="text-stone-800">{landing.stats.flavorNotes}</b> нот
              </span>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
                EFES Kazakhstan
              </span>
            </div>
          )}

          <button
            onClick={handleSeed}
            disabled={seeded === null}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-amber-500 hover:text-amber-700 disabled:opacity-50"
          >
            {seeded === null
              ? "Загрузка…"
              : seeded
                ? "⟳ Перезагрузить демо-данные"
                : "⚡ Загрузить демо-данные"}
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-4">
          <nav className="flex gap-1 overflow-x-auto pb-2">
            {(
              [
                ["admin", "🧑‍🍳 Админка сомелье"],
                ["catalog", "📖 Каталог пива"],
                ["courses", "🎓 Школа Сомелье"],
                ["team", "👥 Команда"],
                ["api", "🔌 API"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`whitespace-nowrap rounded-t-lg px-4 py-2 text-sm font-medium transition ${
                  tab === t
                    ? "bg-amber-600 text-white shadow-sm"
                    : "text-stone-600 hover:bg-amber-100"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {tab === "admin" && <SommelierAdmin />}
        {tab === "catalog" && <Catalog />}
        {tab === "courses" && <Courses />}
        {tab === "team" && <Team />}
        {tab === "api" && <ApiDocs />}
      </main>

      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
        Flavor Tree · EFES Kazakhstan · One Idea University / Anadolu Group ·
        API: /api/brands, /api/flavor-notes, /api/landing
      </footer>
    </div>
  );
}

// ─── Sommelier Admin ─────────────────────────────────────────────────────────

function SommelierAdmin() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [notes, setNotes] = useState<FlavorNote[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [serving, setServing] = useState<{
    servingTempMin: number;
    servingTempMax: number;
    glassType: string;
    seasonality: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "warn" | "err" } | null>(null);

  // Editor state: per-layer arrays of rows
  const [editor, setEditor] = useState<Record<string, EditorRow[]>>({
    TOP: [],
    HEART: [],
    BASE: [],
  });

  const refresh = useCallback(async () => {
    const [b, n] = await Promise.all([
      api<Brand[]>("/admin/brands"),
      api<FlavorNote[]>("/flavor-notes"),
    ]);
    setBrands(b);
    setNotes(n);
    if (b.length > 0 && !selectedBrandId) setSelectedBrandId(b[0].id);
  }, [selectedBrandId]);

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === selectedBrandId) ?? null,
    [brands, selectedBrandId]
  );

  // Load pyramid when brand changes
  useEffect(() => {
    if (!selectedBrandId) return;
    (async () => {
      try {
        const p = await api<Pyramid>(`/brands/${selectedBrandId}/pyramid`);
        const toRow = (n: PyramidNote): EditorRow => ({
          flavorNoteId: n.id,
          intensity: n.intensity,
          sommelierNote: n.sommelierNote ?? "",
        });
        setEditor({
          TOP: p.top.map(toRow),
          HEART: p.heart.map(toRow),
          BASE: p.base.map(toRow),
        });
      } catch {
        setEditor({ TOP: [], HEART: [], BASE: [] });
      }
      try {
        const b = await api<Brand>(`/brands/${selectedBrandId}`);
        setServing(
          b.servingRecommendation
            ? {
                servingTempMin: b.servingRecommendation.servingTempMin,
                servingTempMax: b.servingRecommendation.servingTempMax,
                glassType: b.servingRecommendation.glassType,
                seasonality: b.servingRecommendation.seasonality ?? "",
              }
            : null
        );
      } catch {
        setServing(null);
      }
    })();
  }, [selectedBrandId]);

  const showToast = (msg: string, type: "ok" | "warn" | "err") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const updateRow = (layer: string, idx: number, patch: Partial<EditorRow>) => {
    setEditor((e) => ({
      ...e,
      [layer]: e[layer].map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }));
  };

  const addRow = (layer: string) => {
    const cat = notes.filter((n) => n.category === layer)[0];
    setEditor((e) => ({
      ...e,
      [layer]: [...e[layer], { flavorNoteId: cat?.id ?? "", intensity: 5, sommelierNote: "" }],
    }));
  };

  const removeRow = (layer: string, idx: number) => {
    setEditor((e) => ({
      ...e,
      [layer]: e[layer].filter((_, i) => i !== idx),
    }));
  };

  const saveProfile = async () => {
    if (!selectedBrandId) return;
    setSaving(true);
    try {
      const allNotes = [
        ...editor.TOP.map((r) => ({ ...r, layer: "TOP" as const })),
        ...editor.HEART.map((r) => ({ ...r, layer: "HEART" as const })),
        ...editor.BASE.map((r) => ({ ...r, layer: "BASE" as const })),
      ];
      const res = await api<{ ok: boolean; warnings: string[]; profile: { complete: boolean } }>(
        "/admin/flavor-profiles",
        {
          method: "PUT",
          body: JSON.stringify({ brandId: selectedBrandId, notes: allNotes }),
        }
      );
      if (res.warnings.length > 0) {
        showToast(res.warnings.join(" · "), "warn");
      } else {
        showToast("✅ Вкусовой профиль сохранён", "ok");
      }
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка сохранения", "err");
    } finally {
      setSaving(false);
    }
  };

  const saveServing = async () => {
    if (!selectedBrandId || !serving) return;
    setSaving(true);
    try {
      await api("/admin/serving-recommendations", {
        method: "PUT",
        body: JSON.stringify({ brandId: selectedBrandId, ...serving }),
      });
      showToast("✅ Рекомендации по подаче сохранены", "ok");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Ошибка", "err");
    } finally {
      setSaving(false);
    }
  };

  const addBrand = async () => {
    const name = `Новый сорт ${brands.length + 1}`;
    const b = await api<Brand>("/admin/brands", {
      method: "POST",
      body: JSON.stringify({ name, brandOwner: "Efes Kazakhstan", style: "Lager", abv: 5 }),
    });
    await refresh();
    setSelectedBrandId(b.id);
    showToast(`Добавлен «${name}»`, "ok");
  };

  const notesByLayer = useMemo(() => {
    const m: Record<string, FlavorNote[]> = { TOP: [], HEART: [], BASE: [] };
    for (const n of notes) m[n.category]?.push(n);
    return m;
  }, [notes]);

  return (
    <div className="space-y-4">
      {/* Brand selector */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <span className="text-sm font-semibold text-stone-500">Бренд:</span>
        <select
          value={selectedBrandId ?? ""}
          onChange={(e) => setSelectedBrandId(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium focus:border-amber-500 focus:outline-none"
        >
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} · {b.style} · {b.abv}%
            </option>
          ))}
        </select>
        {selectedBrand?.profile && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              selectedBrand.profile.status === "complete"
                ? "bg-emerald-100 text-emerald-700"
                : selectedBrand.profile.status === "partial"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-stone-100 text-stone-500"
            }`}
          >
            {selectedBrand.profile.status === "complete"
              ? "✅ Профиль заполнен"
              : selectedBrand.profile.status === "partial"
                ? "⚠️ Частично заполнен"
                : "⚪ Пустой профиль"}
          </span>
        )}
        <button
          onClick={addBrand}
          className="ml-auto rounded-lg border border-dashed border-stone-300 px-3 py-2 text-sm text-stone-500 transition hover:border-amber-500 hover:text-amber-700"
        >
          + Новый бренд
        </button>
      </div>

      {/* Pyramid editor */}
      <div className="space-y-5">
        {(Object.keys(LAYERS) as Array<keyof typeof LAYERS>).map((layer, li) => {
          const cfg = LAYERS[layer];
          const rows = editor[layer];
          return (
            <section
              key={layer}
              className={`overflow-hidden rounded-2xl border-2 ${cfg.border} bg-white shadow-sm`}
            >
              <div
                className={`flex items-center justify-between bg-gradient-to-r ${cfg.gradient} px-5 py-3 ${
                  layer === "TOP" ? "text-stone-900" : "text-white"
                }`}
              >
                <div>
                  <h3 className="text-base font-bold">
                    {li === 0 ? "▲ " : li === 1 ? "■ " : "▼ "}
                    {cfg.label}
                  </h3>
                  <p className={`text-xs ${layer === "TOP" ? "text-stone-700" : "text-white/80"}`}>
                    {cfg.sub}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    layer === "TOP" ? "bg-white/60 text-stone-900" : "bg-black/25 text-white"
                  }`}
                >
                  {rows.length} нот
                </span>
              </div>

              <div className="divide-y divide-stone-100">
                {rows.length === 0 && (
                  <p className="px-5 py-4 text-sm text-stone-400">
                    Нет нот в этом слое — добавьте хотя бы одну (профиль останется черновиком)
                  </p>
                )}
                {rows.map((row, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-wrap items-center gap-3 px-5 py-3 ${cfg.bg}`}
                  >
                    <select
                      value={row.flavorNoteId}
                      onChange={(e) => updateRow(layer, idx, { flavorNoteId: e.target.value })}
                      className="min-w-[220px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                    >
                      {notesByLayer[layer].map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.icon} {n.name}
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={row.intensity}
                        onChange={(e) =>
                          updateRow(layer, idx, { intensity: Number(e.target.value) })
                        }
                        className="w-32 accent-amber-600"
                      />
                      <span
                        className={`w-16 rounded-md px-2 py-1 text-center text-xs font-bold ${cfg.badge}`}
                      >
                        {row.intensity}/10
                      </span>
                    </div>

                    <input
                      type="text"
                      placeholder="Комментарий сомелье…"
                      value={row.sommelierNote}
                      onChange={(e) => updateRow(layer, idx, { sommelierNote: e.target.value })}
                      className="min-w-[180px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs focus:border-amber-500 focus:outline-none"
                    />

                    <button
                      onClick={() => removeRow(layer, idx)}
                      className="rounded-lg px-2 py-1 text-sm text-stone-400 transition hover:bg-red-50 hover:text-red-600"
                      title="Удалить ноту"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addRow(layer)}
                className={`w-full border-t border-dashed px-5 py-2.5 text-sm font-medium transition ${cfg.text} hover:underline`}
              >
                + Добавить ноту
              </button>
            </section>
          );
        })}
      </div>

      {/* Serving recommendation */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-stone-700">🍻 Рекомендации по подаче</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="text-xs font-medium text-stone-500">
            Т° мин, °C
            <input
              type="number"
              value={serving?.servingTempMin ?? 4}
              onChange={(e) =>
                setServing((s) => ({
                  servingTempMin: Number(e.target.value),
                  servingTempMax: s?.servingTempMax ?? 8,
                  glassType: s?.glassType ?? "",
                  seasonality: s?.seasonality ?? "",
                }))
              }
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            Т° макс, °C
            <input
              type="number"
              value={serving?.servingTempMax ?? 8}
              onChange={(e) =>
                setServing((s) => ({
                  servingTempMin: s?.servingTempMin ?? 4,
                  servingTempMax: Number(e.target.value),
                  glassType: s?.glassType ?? "",
                  seasonality: s?.seasonality ?? "",
                }))
              }
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            Тип бокала
            <input
              type="text"
              value={serving?.glassType ?? ""}
              onChange={(e) =>
                setServing((s) => ({
                  servingTempMin: s?.servingTempMin ?? 4,
                  servingTempMax: s?.servingTempMax ?? 8,
                  glassType: e.target.value,
                  seasonality: s?.seasonality ?? "",
                }))
              }
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-stone-500">
            Сезонность
            <input
              type="text"
              value={serving?.seasonality ?? ""}
              onChange={(e) =>
                setServing((s) => ({
                  servingTempMin: s?.servingTempMin ?? 4,
                  servingTempMax: s?.servingTempMax ?? 8,
                  glassType: s?.glassType ?? "",
                  seasonality: e.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </label>
        </div>
        <button
          onClick={saveServing}
          disabled={saving}
          className="mt-3 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium transition hover:border-amber-500 disabled:opacity-50"
        >
          Сохранить подачу
        </button>
      </section>

      {/* Save bar */}
      <div className="sticky bottom-4 flex items-center justify-between rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <p className="text-xs text-stone-500">
          {selectedBrand
            ? `Редактируется: ${selectedBrand.name} · ${editor.TOP.length + editor.HEART.length + editor.BASE.length} нот в профиле`
            : "Выберите бренд для редактирования"}
        </p>
        <button
          onClick={saveProfile}
          disabled={saving || !selectedBrandId}
          className="rounded-xl bg-gradient-to-r from-amber-600 to-amber-800 px-6 py-2.5 text-sm font-bold text-white shadow-md transition hover:from-amber-700 hover:to-amber-900 disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "💾 Сохранить вкусовую пирамиду"}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-20 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toast.type === "ok"
              ? "bg-emerald-600 text-white"
              : toast.type === "warn"
                ? "bg-amber-500 text-white"
                : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

function Catalog() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [style, setStyle] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pyramids, setPyramids] = useState<Record<string, Pyramid>>({});

  useEffect(() => {
    const qs = new URLSearchParams();
    if (style) qs.set("style", style);
    if (onlyActive) qs.set("is_active", "true");
    api<{ results: Brand[] }>(`/brands?${qs.toString()}`)
      .then((d) => setBrands(d.results))
      .catch(() => {});
  }, [style, onlyActive]);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!pyramids[id]) {
      try {
        const p = await api<Pyramid>(`/brands/${id}/pyramid`);
        setPyramids((m) => ({ ...m, [id]: p }));
      } catch {
        /* ignore */
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <input
          type="text"
          placeholder="Фильтр по стилю: Pilsner, IPA…"
          value={style}
          onChange={(e) => setStyle(e.target.value)}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={(e) => setOnlyActive(e.target.checked)}
            className="accent-amber-600"
          />
          Только сорта в наличии
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {brands.map((b) => {
          const p = pyramids[b.id];
          return (
            <div
              key={b.id}
              className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md"
            >
              <div
                className="flex cursor-pointer items-center gap-4 p-4"
                onClick={() => toggle(b.id)}
              >
                <img
                  src={b.image}
                  alt={b.name}
                  className="h-20 w-14 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-bold">{b.name}</h3>
                  <p className="text-xs text-stone-500">
                    {b.style} · {b.abv}% · {b.brandOwner}
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs text-stone-400">{b.description}</p>
                </div>
                <span
                  className={`text-lg ${
                    b.profile?.status === "complete"
                      ? ""
                      : "opacity-40"
                  }`}
                  title="Статус профиля"
                >
                  {b.profile?.status === "complete" ? "✅" : b.profile?.status === "partial" ? "⚠️" : "⚪"}
                </span>
              </div>

              {expanded === b.id && (
                <div className="border-t border-stone-100 p-4">
                  {p ? (
                    <PyramidView pyramid={p} />
                  ) : (
                    <p className="text-sm text-stone-400">Загрузка пирамиды…</p>
                  )}
                  {b.servingRecommendation && (
                    <div className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                      🍻 Подача: {b.servingRecommendation.servingTempMin}–
                      {b.servingRecommendation.servingTempMax}°C ·{" "}
                      {b.servingRecommendation.glassType}
                      {b.servingRecommendation.seasonality &&
                        ` · Сезон: ${b.servingRecommendation.seasonality}`}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {brands.length === 0 && (
        <p className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-400">
          Нет сортов по выбранному фильтру
        </p>
      )}
    </div>
  );
}

function PyramidView({ pyramid }: { pyramid: Pyramid }) {
  const bars = (key: "top" | "heart" | "base") => {
    const cfg = LAYERS[key.toUpperCase() as "TOP"];
    return (
      <div className={`rounded-xl border ${cfg.border} p-3`}>
        <p className={`mb-2 text-xs font-bold ${cfg.text}`}>
          {cfg.label} <span className="font-normal opacity-60">· {cfg.sub}</span>
        </p>
        <div className="space-y-1.5">
          {pyramid[key].length === 0 && (
            <p className="text-xs text-stone-400">—</p>
          )}
          {pyramid[key].map((n) => (
            <div key={n.id} className="flex items-center gap-2">
              <span className="w-5 text-center text-sm">{n.icon}</span>
              <span className="w-36 truncate text-xs">{n.name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${cfg.gradient}`}
                  style={{ width: `${n.intensity * 10}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs font-bold text-stone-500">
                {n.intensity}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {bars("top")}
      {bars("heart")}
      {bars("base")}
    </div>
  );
}

// ─── Courses ─────────────────────────────────────────────────────────────────

function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  useEffect(() => {
    api<Course[]>("/courses").then(setCourses).catch(() => {});
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {courses.map((c) => (
        <div
          key={c.id}
          className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
          style={{ borderTopColor: c.color, borderTopWidth: 4 }}
        >
          <span
            className="inline-block rounded-full px-3 py-1 text-xs font-bold text-white"
            style={{ backgroundColor: c.color }}
          >
            Уровень {c.level}
          </span>
          <h3 className="mt-3 text-lg font-bold">{c.title}</h3>
          <p className="mt-2 text-sm text-stone-500">{c.description}</p>
        </div>
      ))}
      {courses.length === 0 && (
        <p className="col-span-full rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-400">
          Курсы не загружены — нажмите «Загрузить демо-данные»
        </p>
      )}
    </div>
  );
}

// ─── Team ────────────────────────────────────────────────────────────────────

function Team() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    api<TeamMember[]>("/team").then(setTeam).catch(() => {});
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {team.map((t) => (
        <div key={t.id} className="rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-sm">
          {t.avatar ? (
            <img src={t.avatar} alt={t.name} className="mx-auto h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-3xl">
              👤
            </div>
          )}
          <h3 className="mt-3 font-bold">{t.name}</h3>
          <p className="text-xs font-medium text-amber-700">{t.role}</p>
          <p className="mt-2 text-xs text-stone-500">{t.bio}</p>
        </div>
      ))}
    </div>
  );
}

// ─── API Docs ────────────────────────────────────────────────────────────────

const API_ENDPOINTS = [
  { m: "GET", p: "/api/brands/", d: "Список брендов. Фильтры: ?style=, ?is_active=true, ?q=, пагинация ?page=&page_size=" },
  { m: "GET", p: "/api/brands/{id}/", d: "Карточка бренда + вложенный serving_recommendation" },
  { m: "POST", p: "/api/brands/", d: "Создать бренд (name, brandOwner, style, abv, description, image обязательны)" },
  { m: "PATCH", p: "/api/brands/{id}/", d: "Обновить бренд (включая вложенный servingRecommendation)" },
  { m: "DELETE", p: "/api/brands/{id}/", d: "Удалить бренд (каскадно — пирамиду и рекомендации)" },
  { m: "GET", p: "/api/brands/{id}/pyramid/", d: "Вкусовая пирамида: {brand, top[], heart[], base[]}, ноты отсортированы по интенсивности" },
  { m: "GET", p: "/api/flavor-notes/", d: "Справочник нот. Фильтр: ?category=TOP|HEART|BASE, ?off_flavour=true" },
  { m: "GET", p: "/api/flavor-notes/{id}/brands/", d: "Обратный поиск: бренды, содержащие эту ноту (нота → пиво)" },
  { m: "GET", p: "/api/courses/", d: "Курсы Школы Сомелье (read-only)" },
  { m: "GET", p: "/api/team/", d: "Команда проекта (read-only)" },
  { m: "GET", p: "/api/landing/", d: "Агрегирующий эндпоинт: project info, team, courses, stats, quote — один запрос" },
  { m: "GET", p: "/api/seed", d: "Загрузка стартовых данных (ноты из FlavorActiV, 6 брендов Efes, профили)" },
  { m: "GET", p: "/api/admin/brands", d: "Админ-список брендов со статусом заполнения профиля (complete/partial/empty)" },
  { m: "POST", p: "/api/admin/brands", d: "Создать бренд из админки" },
  { m: "PUT", p: "/api/admin/flavor-profiles", d: "Заменить пирамиду бренда. Валидация layer == category ноты; warning на пустой слой" },
  { m: "PUT", p: "/api/admin/serving-recommendations", d: "Upsert рекомендаций по подаче (OneToOne)" },
  { m: "POST", p: "/api/admin/flavor-notes", d: "Добавить ноту в справочник" },
  { m: "PATCH", p: "/api/admin/flavor-notes", d: "Обновить ноту (body: {id, …fields})" },
  { m: "DELETE", p: "/api/admin/flavor-notes?id=", d: "Удалить ноту из справочника" },
  { m: "GET", p: "/api/health", d: "Health check" },
];

function ApiDocs() {
  const [tested, setTested] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");

  const test = async (path: string) => {
    setTested(path);
    try {
      const res = await fetch(path);
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2).slice(0, 2000));
    } catch (e) {
      setResult(String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h3 className="font-bold">REST API v1 — Flavor Tree</h3>
        <p className="mt-1 text-sm text-stone-500">
          Все эндпоинты работают под <code className="rounded bg-stone-100 px-1">/api</code>.
          Ответы структурированы под фронтенд: один запрос на страницу, без N+1.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs text-stone-400">
                <th className="py-2 pr-3">Метод</th>
                <th className="py-2 pr-3">URL</th>
                <th className="py-2 pr-3">Описание</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {API_ENDPOINTS.map((e) => (
                <tr key={e.p + e.m} className="border-b border-stone-100">
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        e.m === "GET"
                          ? "bg-emerald-100 text-emerald-700"
                          : e.m === "DELETE"
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {e.m}
                    </span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{e.p}</td>
                  <td className="py-2 pr-3 text-xs text-stone-500">{e.d}</td>
                  <td className="py-2 text-right">
                    {e.m === "GET" && (
                      <button
                        onClick={() => test(e.p)}
                        className="rounded border border-stone-300 px-2 py-1 text-xs hover:border-amber-500"
                      >
                        ▶
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tested && (
          <div className="mt-4">
            <p className="mb-1 text-xs font-bold text-stone-500">
              {tested} — ответ:
            </p>
            <pre className="max-h-80 overflow-auto rounded-xl bg-stone-900 p-4 text-xs text-emerald-300">
              {result}
            </pre>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h4 className="font-bold">📐 Пример: GET /api/brands/{"{id}"}/pyramid/</h4>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-white p-4 text-xs text-stone-700">
{`{
  "brand": "Efes Pilsener",
  "top":   [ {"id":"…","name":"Хмелевая свежесть","icon":"🌿","intensity":8,"description":"…"}, … ],
  "heart": [ {"id":"…","name":"Солодовая плотность","icon":"🌾","intensity":6,"description":"…"}, … ],
  "base":  [ {"id":"…","name":"Хмелевая горчинка","icon":"🌿","intensity":8,"description":"…"}, … ]
}`}
        </pre>
      </div>
    </div>
  );
}
