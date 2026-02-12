"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Trash2,
  Plus,
  Download,
  Upload,
  Link2,
  RefreshCcw,
  LogOut,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";

/**
 * Weekly Training Dashboard (Strava + Manual)
 *
 * ✅ Keeps the redesigned dashboard:
 *   - Time in all 5 HR zones (Z1–Z5). Any unzoned time counts as Zone 1.
 *   - Aerobic = Z1 + Z2
 *   - Anaerobic = Z4 + Z5 (anything above Zone 3)
 *   - Activity totals: Run, Lift, Swim, Bike, Cardio (everything else)
 *   - Zone colors: Z1 light blue, Z2 green, Z3 yellow, Z4 orange, Z5 red
 *   - Time formatting: <60m => Xm ; >=60m => Xh Ym
 *
 * ✅ Restores Strava connect + sync:
 *   - Connect Strava (OAuth via your backend)
 *   - Sync selected week (activities + optional HR streams)
 *
 * Backend endpoints expected:
 *   - GET  /api/strava/auth-url
 *   - GET  /api/strava/callback
 *   - POST /api/strava/logout
 *   - GET  /api/strava/me
 *   - GET  /api/strava/activities?after=<unix>&before=<unix>
 *   - GET  /api/strava/streams?activityId=<id>
 */

const STORAGE_KEY = "weekly-training-dashboard:v4";

const ACTIVITY_TYPES = ["Run", "Lift", "Swim", "Bike", "Cardio"] as const;
type ActivityType = (typeof ACTIVITY_TYPES)[number];

type Session = {
  id: string;
  date: string; // YYYY-MM-DD
  type: ActivityType;
  durationMin: number;
  z1Min: number;
  z2Min: number;
  z3Min: number;
  z4Min: number;
  z5Min: number;
  notes?: string;
  source?: "manual" | "strava";
  externalId?: string; // strava activity id
};

type HrZones = {
  z2Low: number;
  z3Low: number;
  z4Low: number;
  z5Low: number;
};

const DEFAULT_HR_ZONES: HrZones = {
  z2Low: 130,
  z3Low: 150,
  z4Low: 165,
  z5Low: 180,
};

type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string; // ISO
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  average_heartrate?: number;
  max_heartrate?: number;
};

type StravaStreamsResponse = {
  time?: { data: number[] };
  heartrate?: { data: number[] };
};

const ZONE_COLORS: Record<"Z1" | "Z2" | "Z3" | "Z4" | "Z5", string> = {
  Z1: "#7DD3FC", // light blue
  Z2: "#22C55E", // green
  Z3: "#FACC15", // yellow
  Z4: "#FB923C", // orange
  Z5: "#EF4444", // red
};

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  Run: "#3B82F6", // blue
  Lift: "#A855F7", // purple
  Swim: "#06B6D4", // cyan
  Bike: "#F97316", // orange
  Cardio: "#64748B", // slate
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function parseNum(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfWeekISO(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function withinWeek(dateISO: string, weekStartISO: string) {
  const start = weekStartISO;
  const end = addDaysISO(weekStartISO, 7);
  return dateISO >= start && dateISO < end;
}

function isoToUnixSeconds(iso: string) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function formatDuration(minTotal: number) {
  const m = clampNonNeg(minTotal);
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  const rem = Math.round(m - h * 60);
  if (rem <= 0) return `${h}h`;
  if (rem >= 60) return `${h + 1}h`;
  return `${h}h ${rem}m`;
}

function normalizeTypeToActivityType(input: any): ActivityType {
  const t = String(input || "").toLowerCase();
  if (t === "run") return "Run";
  if (t === "lift" || t === "strength" || t === "weight" || t === "weights") return "Lift";
  if (t === "swim") return "Swim";
  if (t === "bike" || t === "ride" || t === "cycling") return "Bike";
  return "Cardio";
}

function mapStravaToActivityType(stravaType: string, sportType?: string): ActivityType {
  const t = String(sportType || stravaType || "").toLowerCase();
  if (t.includes("run")) return "Run";
  if (t.includes("swim")) return "Swim";
  if (t.includes("ride") || t.includes("bike") || t.includes("cycling")) return "Bike";
  if (t.includes("weight") || t.includes("strength")) return "Lift";
  return "Cardio";
}

function normalizeSession(s: Partial<Session>): Session {
  const durationMin = clampNonNeg(Number(s.durationMin ?? 0));
  const z1Min = clampNonNeg(Number(s.z1Min ?? 0));
  const z2Min = clampNonNeg(Number(s.z2Min ?? 0));
  const z3Min = clampNonNeg(Number(s.z3Min ?? 0));
  const z4Min = clampNonNeg(Number(s.z4Min ?? 0));
  const z5Min = clampNonNeg(Number(s.z5Min ?? 0));

  return {
    id: typeof s.id === "string" ? s.id : uid(),
    date: typeof s.date === "string" ? s.date : new Date().toISOString().slice(0, 10),
    type: normalizeTypeToActivityType((s as any).type),
    durationMin,
    z1Min,
    z2Min,
    z3Min,
    z4Min,
    z5Min,
    notes: typeof s.notes === "string" ? s.notes : "",
    source: s.source === "strava" ? "strava" : "manual",
    externalId: typeof s.externalId === "string" ? s.externalId : undefined,
  };
}

function safeLoad(): {
  weekStartISO: string;
  sessions: Session[];
  hrZones: HrZones;
  strava?: { connected: boolean; athleteName?: string };
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        weekStartISO: startOfWeekISO(),
        sessions: [],
        hrZones: DEFAULT_HR_ZONES,
        strava: { connected: false },
      };
    }
    const parsed = JSON.parse(raw);
    return {
      weekStartISO: typeof parsed.weekStartISO === "string" ? parsed.weekStartISO : startOfWeekISO(),
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSession) : [],
      hrZones:
        parsed.hrZones && typeof parsed.hrZones === "object"
          ? {
              z2Low: Number(parsed.hrZones.z2Low ?? DEFAULT_HR_ZONES.z2Low),
              z3Low: Number(parsed.hrZones.z3Low ?? DEFAULT_HR_ZONES.z3Low),
              z4Low: Number(parsed.hrZones.z4Low ?? DEFAULT_HR_ZONES.z4Low),
              z5Low: Number(parsed.hrZones.z5Low ?? DEFAULT_HR_ZONES.z5Low),
            }
          : DEFAULT_HR_ZONES,
      strava:
        parsed.strava && typeof parsed.strava === "object" ? parsed.strava : { connected: false },
    };
  } catch {
    return {
      weekStartISO: startOfWeekISO(),
      sessions: [],
      hrZones: DEFAULT_HR_ZONES,
      strava: { connected: false },
    };
  }
}

function safeSave(data: any) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getZonedMinutes(s: Session) {
  return s.z1Min + s.z2Min + s.z3Min + s.z4Min + s.z5Min;
}

function getUnzonedMinutes(s: Session) {
  return Math.max(0, s.durationMin - getZonedMinutes(s));
}

function weekZoneTotalsAdjustedToZ1(sessions: Session[]) {
  let z1 = 0,
    z2 = 0,
    z3 = 0,
    z4 = 0,
    z5 = 0;

  for (const s of sessions) {
    z1 += s.z1Min + getUnzonedMinutes(s);
    z2 += s.z2Min;
    z3 += s.z3Min;
    z4 += s.z4Min;
    z5 += s.z5Min;
  }

  return { z1, z2, z3, z4, z5 };
}

function activityTotals(sessions: Session[]) {
  const totals: Record<ActivityType, number> = {
    Run: 0,
    Lift: 0,
    Swim: 0,
    Bike: 0,
    Cardio: 0,
  };
  for (const s of sessions) totals[s.type] += s.durationMin;
  return totals;
}

function warnZones(s: Session) {
  const zones = getZonedMinutes(s);
  if (zones === 0) return null;
  if (zones > s.durationMin + 0.001) return "Zone minutes exceed duration";
  if (zones < s.durationMin - 0.001) return "Some time is unzoned (counts as Z1)";
  return null;
}

function computeZoneMinutesFromStreams(streams: StravaStreamsResponse, zones: HrZones) {
  const hr = streams.heartrate?.data;
  const time = streams.time?.data;
  if (!hr || !time || hr.length < 2 || time.length < 2 || hr.length !== time.length) {
    return { z1Min: 0, z2Min: 0, z3Min: 0, z4Min: 0, z5Min: 0, hasStreams: false };
  }

  let z1 = 0,
    z2 = 0,
    z3 = 0,
    z4 = 0,
    z5 = 0;

  for (let i = 1; i < hr.length; i++) {
    const dt = Math.max(0, (time[i] ?? 0) - (time[i - 1] ?? 0));
    const bpm = hr[i] ?? 0;
    if (bpm >= zones.z5Low) z5 += dt;
    else if (bpm >= zones.z4Low) z4 += dt;
    else if (bpm >= zones.z3Low) z3 += dt;
    else if (bpm >= zones.z2Low) z2 += dt;
    else z1 += dt;
  }

  return {
    z1Min: Math.round(z1 / 60),
    z2Min: Math.round(z2 / 60),
    z3Min: Math.round(z3 / 60),
    z4Min: Math.round(z4 / 60),
    z5Min: Math.round(z5 / 60),
    hasStreams: true,
  };
}

function pct(part: number, total: number) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return (part / total) * 100;
}

function renderPercentLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) {
  // Don’t label tiny slices.
  if (!percent || percent < 0.04) return null;

  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="currentColor" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-medium">
      {(percent * 100).toFixed(0)}%
    </text>
  );
}

function LegendList({
  items,
}: {
  items: { name: string; color: string; valueMin: number; totalMin: number }[];
}) {
  return (
    <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
      {items.map((it) => {
        const p = pct(it.valueMin, it.totalMin).toFixed(0);
        return (
          <div key={it.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: it.color }} />
            <span className="truncate">
              <span className="font-medium text-foreground">{it.name}</span>
              <span className="text-muted-foreground"> · {formatDuration(it.valueMin)} · {p}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function renderPercentLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) {
  // Don’t label tiny slices.
  if (!percent || percent < 0.04) return null;

  const RADIAN = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.6;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);

  return (
    <text x={x} y={y} fill="currentColor" textAnchor="middle" dominantBaseline="central" className="text-[11px] font-medium">
      {(percent * 100).toFixed(0)}%
    </text>
  );
}

  let z1 = 0,
    z2 = 0,
    z3 = 0,
    z4 = 0,
    z5 = 0;

  for (let i = 1; i < hr.length; i++) {
    const dt = Math.max(0, (time[i] ?? 0) - (time[i - 1] ?? 0));
    const bpm = hr[i] ?? 0;
    if (bpm >= zones.z5Low) z5 += dt;
    else if (bpm >= zones.z4Low) z4 += dt;
    else if (bpm >= zones.z3Low) z3 += dt;
    else if (bpm >= zones.z2Low) z2 += dt;
    else z1 += dt;
  }

  return {
    z1Min: Math.round(z1 / 60),
    z2Min: Math.round(z2 / 60),
    z3Min: Math.round(z3 / 60),
    z4Min: Math.round(z4 / 60),
    z5Min: Math.round(z5 / 60),
    hasStreams: true,
  };
}

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function apiPost<T>(url: string, body?: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function WeeklyTrainingDashboardApp() {
  const loaded = useMemo(() => safeLoad(), []);

  const [weekStartISO, setWeekStartISO] = useState<string>(loaded.weekStartISO);
  const [sessions, setSessions] = useState<Session[]>(loaded.sessions);
  const [hrZones, setHrZones] = useState<HrZones>(loaded.hrZones);
  const [strava, setStrava] = useState<{ connected: boolean; athleteName?: string }>(
    loaded.strava ?? { connected: false }
  );

  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [syncStatus, setSyncStatus] = useState<string>("");
  const [syncError, setSyncError] = useState<string>("");

  useEffect(() => {
    safeSave({ weekStartISO, sessions, hrZones, strava });
  }, [weekStartISO, sessions, hrZones, strava]);

  // If backend redirects back with these query params
  useEffect(() => {
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("strava_connected");
    const athlete = url.searchParams.get("athlete");
    if (connected === "1") {
      setStrava({ connected: true, athleteName: athlete || undefined });
      setActiveTab("dashboard");
      url.searchParams.delete("strava_connected");
      url.searchParams.delete("athlete");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const weekSessions = useMemo(
    () => sessions.filter((s) => withinWeek(s.date, weekStartISO)).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [sessions, weekStartISO]
  );

  const weekEndISO = addDaysISO(weekStartISO, 6);

  const totals = useMemo(() => {
    const totalMin = weekSessions.reduce((acc, s) => acc + s.durationMin, 0);

    const z = weekZoneTotalsAdjustedToZ1(weekSessions);
    const z1Min = z.z1;
    const z2Min = z.z2;
    const z3Min = z.z3;
    const z4Min = z.z4;
    const z5Min = z.z5;

    const aerobicMin = z1Min + z2Min;
    const anaerobicMin = z4Min + z5Min;

    const activityMin = activityTotals(weekSessions);

    return {
      totalMin,
      z1Min,
      z2Min,
      z3Min,
      z4Min,
      z5Min,
      aerobicMin,
      anaerobicMin,
      activityMin,
    };
  }, [weekSessions]);

  const zoneChartData = useMemo(
    () =>
      [
        { name: "Z1", value: totals.z1Min },
        { name: "Z2", value: totals.z2Min },
        { name: "Z3", value: totals.z3Min },
        { name: "Z4", value: totals.z4Min },
        { name: "Z5", value: totals.z5Min },
      ].filter((x) => x.value > 0),
    [totals]
  );

  const zoneTotalForPct = useMemo(() => zoneChartData.reduce((a, b) => a + b.value, 0), [zoneChartData]);

  const activityChartData = useMemo(
    () =>
      (ACTIVITY_TYPES as unknown as ActivityType[])
        .map((t) => ({ name: t, value: totals.activityMin[t] }))
        .filter((x) => x.value > 0),
    [totals]
  );

  const activityTotalForPct = useMemo(() => activityChartData.reduce((a, b) => a + b.value, 0), [activityChartData]);

  const byDay = useMemo(() => {
    const labels = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStartISO, i));
    const map = new Map<string, number>(labels.map((d) => [d, 0]));
    for (const s of weekSessions) {
      map.set(s.date, (map.get(s.date) ?? 0) + s.durationMin);
    }
    return labels.map((date) => ({
      date: date.slice(5),
      minutes: map.get(date) ?? 0,
    }));
  }, [weekSessions, weekStartISO]);

  const [form, setForm] = useState<Partial<Session>>(() => ({
    date: weekStartISO,
    type: "Run",
    durationMin: 60,
    z1Min: 0,
    z2Min: 60,
    z3Min: 0,
    z4Min: 0,
    z5Min: 0,
    notes: "",
    source: "manual",
  }));

  useEffect(() => {
    setForm((f) => ({ ...f, date: weekStartISO }));
  }, [weekStartISO]);

  function addSession() {
    const s = normalizeSession({ ...form, source: "manual" });
    setSessions((prev) => [s, ...prev]);
    setForm((f) => ({
      ...f,
      durationMin: 60,
      z1Min: 0,
      z2Min: 60,
      z3Min: 0,
      z4Min: 0,
      z5Min: 0,
      notes: "",
    }));
  }

  function removeSession(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  function resetWeek() {
    setWeekStartISO(startOfWeekISO());
  }

  function exportData() {
    downloadJson(`weekly-training-${weekStartISO}.json`, { weekStartISO, sessions, hrZones, strava });
  }

  function importData(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ""));
        const nextWeek = typeof parsed.weekStartISO === "string" ? parsed.weekStartISO : weekStartISO;
        const nextSessions = Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSession) : sessions;
        setWeekStartISO(nextWeek);
        setSessions(nextSessions);
        if (parsed.hrZones) {
          setHrZones({
            z2Low: Number(parsed.hrZones.z2Low ?? hrZones.z2Low),
            z3Low: Number(parsed.hrZones.z3Low ?? hrZones.z3Low),
            z4Low: Number(parsed.hrZones.z4Low ?? hrZones.z4Low),
            z5Low: Number(parsed.hrZones.z5Low ?? hrZones.z5Low),
          });
        }
        if (parsed.strava) {
          setStrava({ connected: Boolean(parsed.strava.connected), athleteName: parsed.strava.athleteName });
        }
      } catch {
        // ignore
      }
    };
    reader.readAsText(file);
  }

  async function connectStrava() {
    setSyncError("");
    setSyncStatus("Creating Strava authorization link…");
    try {
      const r = await apiGet<{ url: string }>("/api/strava/auth-url");
      window.location.href = r.url;
    } catch (e: any) {
      setSyncStatus("");
      setSyncError(e?.message || "Failed to start Strava auth");
    }
  }

  async function logoutStrava() {
    setSyncError("");
    setSyncStatus("Disconnecting…");
    try {
      await apiPost<{ ok: true }>("/api/strava/logout");
      setStrava({ connected: false });
      setSyncStatus("");
    } catch (e: any) {
      setSyncStatus("");
      setSyncError(e?.message || "Failed to disconnect");
    }
  }

  async function syncFromStravaForWeek() {
    setSyncError("");
    setSyncStatus("Syncing activities from Strava…");

    try {
      const after = isoToUnixSeconds(weekStartISO + "T00:00:00Z");
      const before = isoToUnixSeconds(addDaysISO(weekStartISO, 7) + "T00:00:00Z");

      const activities = await apiGet<StravaActivity[]>(`/api/strava/activities?after=${after}&before=${before}`);

      const baseSessions: Session[] = activities.map((a) => {
        const dateISO = new Date(a.start_date).toISOString().slice(0, 10);
        const durationMin = Math.round((a.moving_time ?? a.elapsed_time ?? 0) / 60);
        return normalizeSession({
          id: `strava-${a.id}`,
          externalId: String(a.id),
          source: "strava",
          date: dateISO,
          type: mapStravaToActivityType(a.type, a.sport_type),
          durationMin,
          notes: a.name || "",
        });
      });

      const withHr = activities.filter(
        (a) => typeof a.average_heartrate === "number" || typeof a.max_heartrate === "number"
      );
      const streamFetchCount = Math.min(withHr.length, 25);
      const zoneByActivityId = new Map<number, { z1Min: number; z2Min: number; z3Min: number; z4Min: number; z5Min: number }>();

      for (let i = 0; i < streamFetchCount; i++) {
        const a = withHr[i];
        setSyncStatus(`Syncing zones (${i + 1}/${streamFetchCount})…`);
        try {
          const streams = await apiGet<StravaStreamsResponse>(`/api/strava/streams?activityId=${a.id}`);
          const z = computeZoneMinutesFromStreams(streams, hrZones);
          if (z.hasStreams) {
            zoneByActivityId.set(a.id, {
              z1Min: z.z1Min,
              z2Min: z.z2Min,
              z3Min: z.z3Min,
              z4Min: z.z4Min,
              z5Min: z.z5Min,
            });
          }
        } catch {
          // ignore per-activity failures
        }
      }

      const mergedSessions = baseSessions.map((s) => {
        const idNum = Number(s.externalId || 0);
        const z = zoneByActivityId.get(idNum);
        if (!z) return s;
        return normalizeSession({ ...s, ...z });
      });

      setSessions((prev) => {
        // Keep ALL manual sessions. Replace Strava sessions ONLY for the selected week.
        const keepManual = prev.filter((p) => p.source !== "strava" || !withinWeek(p.date, weekStartISO));
        return [...mergedSessions, ...keepManual];
      });

      setSyncStatus(`Synced ${activities.length} activities. Zones computed for up to ${streamFetchCount}.`);
      setTimeout(() => setSyncStatus(""), 2500);

      try {
        const me = await apiGet<{ athleteName?: string }>("/api/strava/me");
        setStrava({ connected: true, athleteName: me.athleteName });
      } catch {
        setStrava({ connected: true });
      }
    } catch (e: any) {
      setSyncStatus("");
      setSyncError(e?.message || "Failed to sync from Strava");
    }
  }

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex flex-col gap-2"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Weekly Training Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                HR zones (Z1–Z5), Aerobic vs Anaerobic, and total time by activity. Unzoned counts as Z1.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs">Week start (Mon)</Label>
                  <Input
                    type="date"
                    value={weekStartISO}
                    onChange={(e) => setWeekStartISO(e.target.value)}
                    className="w-[170px]"
                  />
                </div>
                <Button variant="secondary" onClick={resetWeek} className="mt-5">
                  This week
                </Button>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" onClick={exportData} className="mt-5">
                  <Download className="mr-2 h-4 w-4" /> Export
                </Button>

                <label className="mt-5">
                  <input
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importData(f);
                      e.currentTarget.value = "";
                    }}
                  />
                  <Button asChild variant="outline">
                    <span>
                      <Upload className="mr-2 h-4 w-4" /> Import
                    </span>
                  </Button>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Week: <span className="font-medium">{weekStartISO}</span> → <span className="font-medium">{weekEndISO}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {strava.connected ? (
                <>
                  <div className="text-xs text-muted-foreground">
                    Connected: <span className="font-medium">{strava.athleteName || "Strava"}</span>
                  </div>
                  <Button variant="secondary" onClick={syncFromStravaForWeek}>
                    <RefreshCcw className="mr-2 h-4 w-4" /> Sync week
                  </Button>
                  <Button variant="outline" onClick={logoutStrava}>
                    <LogOut className="mr-2 h-4 w-4" /> Disconnect
                  </Button>
                </>
              ) : (
                <Button onClick={connectStrava}>
                  <Link2 className="mr-2 h-4 w-4" /> Connect Strava
                </Button>
              )}
            </div>
          </div>

          {(syncStatus || syncError) && (
            <div className="rounded-xl border p-3 text-sm">
              {syncStatus && <div className="text-muted-foreground">{syncStatus}</div>}
              {syncError && <div className="mt-1 text-destructive">{syncError}</div>}
            </div>
          )}
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="add">Add session</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard">
            {/* Summary */}
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Total training time</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{formatDuration(totals.totalMin)}</div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Aerobic time (Z1 + Z2)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{formatDuration(totals.aerobicMin)}</div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Anaerobic time (Z4 + Z5)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{formatDuration(totals.anaerobicMin)}</div>
                </CardContent>
              </Card>
            </div>

            {/* Zone cards */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {([
                ["Z1", totals.z1Min],
                ["Z2", totals.z2Min],
                ["Z3", totals.z3Min],
                ["Z4", totals.z4Min],
                ["Z5", totals.z5Min],
              ] as const).map(([label, mins]) => (
                <Card key={label} className="rounded-2xl shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: (ZONE_COLORS as any)[label] }} />
                        {label}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{formatDuration(mins)}</div>
                    {label === "Z1" && (
                      <div className="mt-1 text-xs text-muted-foreground">Includes any unzoned time.</div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Activity totals */}
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {(ACTIVITY_TYPES as unknown as ActivityType[]).map((t) => (
                <Card key={t} className="rounded-2xl shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm text-muted-foreground">{t}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-semibold">{formatDuration(totals.activityMin[t])}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Charts */}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Zone distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {zoneChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Add sessions or sync Strava to see zone distribution.
                    </div>
                  ) : (
                    <>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={zoneChartData}
                              dataKey="value"
                              nameKey="name"
                              outerRadius={95}
                              labelLine={false}
                              label={renderPercentLabel}
                            >
                              {zoneChartData.map((entry) => (
                                <Cell key={entry.name} fill={(ZONE_COLORS as any)[entry.name]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v: any, _n: any, p: any) => {
                                const total = zoneChartData.reduce((a, b) => a + b.value, 0);
                                const val = Number(v);
                                const perc = pct(val, total).toFixed(0);
                                return [`${formatDuration(val)} (${perc}%)`, p?.name];
                              }}
                            />
                            {/* keep Legend component mounted for layout consistency */}
                            <Legend content={() => null} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <LegendList
                        items={zoneChartData.map((d) => ({
                          name: d.name,
                          color: (ZONE_COLORS as any)[d.name] || "#94A3B8",
                          valueMin: d.value,
                          totalMin: zoneTotalForPct,
                        }))}
                      />
                    </>
                  )}
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm lg:col-span-3">
                <CardHeader>
                  <CardTitle className="text-base">Training time by day</CardTitle>
                </CardHeader>
                <CardContent className="h-[280px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip formatter={(v: any) => formatDuration(Number(v))} />
                      <Bar dataKey="minutes" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
              <Card className="rounded-2xl shadow-sm lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Activity distribution</CardTitle>
                </CardHeader>
                <CardContent>
                  {activityChartData.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Add sessions or sync Strava to see the activity breakdown.
                    </div>
                  ) : (
                    <>
                      <div className="h-[240px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={activityChartData}
                              dataKey="value"
                              nameKey="name"
                              outerRadius={95}
                              labelLine={false}
                              label={renderPercentLabel}
                            >
                              {activityChartData.map((entry) => (
                                <Cell key={entry.name} fill={(ACTIVITY_COLORS as any)[entry.name]} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v: any, _n: any, p: any) => {
                                const total = activityChartData.reduce((a, b) => a + b.value, 0);
                                const val = Number(v);
                                const perc = pct(val, total).toFixed(0);
                                return [`${formatDuration(val)} (${perc}%)`, p?.name];
                              }}
                            />
                            <Legend content={() => null} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <LegendList
                        items={activityChartData.map((d) => ({
                          name: d.name,
                          color: (ACTIVITY_COLORS as any)[d.name] || "#94A3B8",
                          valueMin: d.value,
                          totalMin: activityTotalForPct,
                        }))}
                      />
                    </>
                  )}
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm lg:col-span-3">
                <CardHeader>
                  <CardTitle className="text-base">Sessions this week</CardTitle>
                </CardHeader>
                <CardContent>
                  {weekSessions.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">No sessions yet. Add one or sync Strava.</div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[110px]">Date</TableHead>
                          <TableHead className="w-[110px]">Activity</TableHead>
                          <TableHead className="text-right">Duration</TableHead>
                          <TableHead className="text-right">Z1</TableHead>
                          <TableHead className="text-right">Z2</TableHead>
                          <TableHead className="text-right">Z3</TableHead>
                          <TableHead className="text-right">Z4</TableHead>
                          <TableHead className="text-right">Z5</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="w-[90px]"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {weekSessions.map((s) => {
                          const warning = warnZones(s);
                          const z1Adj = s.z1Min + getUnzonedMinutes(s);
                          return (
                            <TableRow key={s.id} className={warning ? "bg-muted/30" : ""}>
                              <TableCell className="font-medium">{s.date}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span>{s.type}</span>
                                  {s.source === "strava" && (
                                    <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">Strava</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{formatDuration(s.durationMin)}</TableCell>
                              <TableCell className="text-right">{formatDuration(z1Adj)}</TableCell>
                              <TableCell className="text-right">{formatDuration(s.z2Min)}</TableCell>
                              <TableCell className="text-right">{formatDuration(s.z3Min)}</TableCell>
                              <TableCell className="text-right">{formatDuration(s.z4Min)}</TableCell>
                              <TableCell className="text-right">{formatDuration(s.z5Min)}</TableCell>
                              <TableCell>
                                <div className="flex flex-col">
                                  <span className="text-sm">{s.notes || "—"}</span>
                                  {warning && <span className="text-xs text-muted-foreground">⚠ {warning}</span>}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">
                                {s.source === "manual" ? (
                                  <Button variant="ghost" size="icon" onClick={() => removeSession(s.id)} aria-label="Delete">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <div className="text-xs text-muted-foreground">—</div>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="add">
            <div className="mt-4 grid grid-cols-1 gap-4">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Add a training session (manual)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="grid gap-1">
                      <Label>Date</Label>
                      <Input
                        type="date"
                        value={String(form.date ?? weekStartISO)}
                        onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label>Activity</Label>
                      <Select
                        value={String(form.type ?? "Run")}
                        onValueChange={(v) => setForm((f) => ({ ...f, type: v as ActivityType }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {(ACTIVITY_TYPES as unknown as ActivityType[]).map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid gap-1">
                      <Label>Duration (minutes)</Label>
                      <Input
                        inputMode="numeric"
                        value={String(form.durationMin ?? 0)}
                        onChange={(e) => setForm((f) => ({ ...f, durationMin: parseNum(e.target.value) }))}
                      />
                    </div>

                    <div className="grid gap-1">
                      <Label>Notes (optional)</Label>
                      <Input
                        value={String(form.notes ?? "")}
                        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder="Tempo run, intervals, weights…"
                      />
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    {([
                      ["Z1", "z1Min"],
                      ["Z2", "z2Min"],
                      ["Z3", "z3Min"],
                      ["Z4", "z4Min"],
                      ["Z5", "z5Min"],
                    ] as const).map(([label, key]) => (
                      <div key={key} className="grid gap-1">
                        <Label>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: (ZONE_COLORS as any)[label] }} />
                            {label} (min)
                          </span>
                        </Label>
                        <Input
                          inputMode="numeric"
                          value={String((form as any)[key] ?? 0)}
                          onChange={(e) => setForm((f) => ({ ...f, [key]: parseNum(e.target.value) }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      Any time not assigned to zones will automatically count as <span className="font-medium">Zone 1</span>.
                    </div>
                    <Button onClick={addSession}>
                      <Plus className="mr-2 h-4 w-4" /> Add session
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="settings">
            <div className="mt-4 grid grid-cols-1 gap-4">
              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">HR zone thresholds (for Strava HR streams)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Set the <span className="font-medium">lower bound</span> BPM for each zone.
                  </p>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {([
                      ["Z2 low", "z2Low"],
                      ["Z3 low", "z3Low"],
                      ["Z4 low", "z4Low"],
                      ["Z5 low", "z5Low"],
                    ] as const).map(([label, key]) => (
                      <div key={key} className="grid gap-1">
                        <Label>{label} (BPM)</Label>
                        <Input
                          inputMode="numeric"
                          value={String((hrZones as any)[key] ?? 0)}
                          onChange={(e) => setHrZones((z) => ({ ...z, [key]: parseNum(e.target.value) }))}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 text-xs text-muted-foreground">
                    If synced sessions show 0 zone time, either the activity lacks HR streams or your Strava scope doesn’t include it.
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base">Strava sync</CardTitle>
                </CardHeader>
                <CardContent>
                  {strava.connected ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" onClick={syncFromStravaForWeek}>
                        <RefreshCcw className="mr-2 h-4 w-4" /> Sync selected week
                      </Button>
                      <Button variant="outline" onClick={logoutStrava}>
                        <LogOut className="mr-2 h-4 w-4" /> Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={connectStrava}>
                      <Link2 className="mr-2 h-4 w-4" /> Connect Strava
                    </Button>
                  )}

                  <div className="mt-3 text-xs text-muted-foreground">
                    Backend endpoints must exist under <span className="font-medium">/api/strava</span>.
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
