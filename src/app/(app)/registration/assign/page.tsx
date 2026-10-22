"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, PageHeader, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { applianceNames, putLocalFromServer } from "@/lib/local-db";
import type { Appliance, RosterRow } from "@/lib/types";

interface Pending {
  id: string;
  name: string;
  created_at: string;
  disability_type: string | null;
  phone: string | null;
}

const SIDES = ["", "Lt", "Rt", "Bil", "Uni", "Adult", "Child"];
const REG_RE = /^[A-Za-z0-9\-/]{1,12}$/;

/** Staff type the Reg. No. by hand. Saved straight to the server (it enforces that the number is unique). */
export default function AssignPage() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);

  // State is only set inside promise callbacks (never synchronously in the effect body).
  const load = useCallback(() => {
    const request: PromiseLike<{ data: unknown; error: { code?: string } | null }> = navigator.onLine
      ? createClient().rpc("unassigned_registrations")
      : Promise.resolve({ data: null, error: { code: "OFFLINE" } });
    request.then(({ data, error }) => {
      if (error) {
        setErr(
          error.code === "OFFLINE"
            ? "You are offline. Assigning a Reg. No. needs a connection so the number can be checked as unique."
            : error.code === "PGRST202"
              ? "The server function is not installed yet. Run supabase/sql/1_run_now.sql in Supabase first."
              : "Could not load the list. Try again.",
        );
        return;
      }
      setErr(null);
      setRows((data ?? []) as Pending[]);
    }, () => setErr("Could not load the list. Check your connection."));
  }, []);

  useEffect(() => {
    load();
    void applianceNames().then(setNames);
  }, [load]);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <PageHeader title="Assign Reg. No." subtitle="People registered at the camp who do not have a Reg. No. yet" />
      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
      {err && <Button variant="secondary" full onClick={load}>Try again</Button>}
      {rows === null && !err && <p className="text-ink-muted">Loading...</p>}
      {rows?.length === 0 && (
        <Card className="text-center">
          <p className="font-bold text-ink">Everyone registered so far has a Reg. No.</p>
          <p className="mt-1 text-sm text-ink-muted">New registrations appear here after they have synced.</p>
        </Card>
      )}
      {rows?.map((r) => (
        <AssignRow key={r.id} p={r} names={names} onDone={() => setRows((x) => (x ?? []).filter((y) => y.id !== r.id))} />
      ))}
    </div>
  );
}

function AssignRow({ p, names, onDone }: { p: Pending; names: string[]; onDone: () => void }) {
  const toast = useToast();
  const [reg, setReg] = useState("");
  const [apps, setApps] = useState<Appliance[]>([{ name: "", side: null }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setApp = (i: number, patch: Partial<Appliance>) => setApps((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setErr(null);
    const regNo = reg.trim();
    const list = apps.map((a) => ({ name: a.name.trim(), side: a.side || null })).filter((a) => a.name);
    if (!REG_RE.test(regNo)) return setErr("Type the Reg. No. exactly as on the token (letters, digits, - or /, up to 12 characters).");
    if (list.length === 0) return setErr("Add at least one appliance.");
    if (!navigator.onLine) return setErr("You are offline. Try again when connected.");
    setBusy(true);
    const { data, error } = await createClient().rpc("promote_registration", {
      p_beneficiary_id: p.id,
      p_reg_no: regNo,
      p_appliances: list,
    });
    setBusy(false);
    if (error) {
      setErr(/already in use/i.test(error.message) ? `Reg. No. ${regNo} is already used by someone else. Check the token number.` : "Could not save. Check your connection and try again.");
      return;
    }
    // Make the person searchable in Distribution on this phone right away; others get them on their next refresh.
    try { await putLocalFromServer(data as RosterRow); } catch { /* list refresh will pick it up */ }
    toast(`Reg. No. ${regNo} saved for ${p.name}`, "ok");
    onDone();
  }

  return (
    <Card className="space-y-3">
      <div>
        <p className="text-lg font-bold text-ink">{p.name}</p>
        <p className="text-sm text-ink-muted">
          Registered {new Date(p.created_at).toLocaleTimeString("en-IN", { timeStyle: "short" })}
          {p.phone ? ` · ${p.phone}` : ""}
          {p.disability_type ? ` · ${p.disability_type}` : ""}
        </p>
      </div>
      <label className="block text-sm font-semibold text-ink">
        Reg. No. (as written on the token)
        <input
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          inputMode="text"
          autoComplete="off"
          className="mt-1 h-14 w-full rounded-xl border-2 border-line bg-white px-4 text-2xl font-extrabold tracking-wide"
        />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-ink">Appliances</p>
        <datalist id={`apps-${p.id}`}>{names.map((n) => <option key={n} value={n} />)}</datalist>
        {apps.map((a, i) => (
          <div key={i} className="flex gap-2">
            <input
              list={`apps-${p.id}`}
              value={a.name}
              onChange={(e) => setApp(i, { name: e.target.value })}
              placeholder="e.g. Wheel chair"
              aria-label="Appliance"
              className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3"
            />
            <select
              value={a.side ?? ""}
              onChange={(e) => setApp(i, { side: e.target.value || null })}
              aria-label="Side or category"
              className="h-12 rounded-xl border border-line bg-white px-2"
            >
              {SIDES.map((s) => <option key={s} value={s}>{s || "-"}</option>)}
            </select>
            {apps.length > 1 && (
              <button onClick={() => setApps((x) => x.filter((_, j) => j !== i))} aria-label="Remove appliance" className="h-12 w-10 text-bad-fg font-bold">×</button>
            )}
          </div>
        ))}
        <Button variant="ghost" onClick={() => setApps((x) => [...x, { name: "", side: null }])}>+ Add another appliance</Button>
      </div>
      {err && <p role="alert" className="rounded-2xl bg-bad-bg px-4 py-3 text-sm font-semibold text-bad-fg">{err}</p>}
      <Button full size="lg" onClick={save} loading={busy}>Save Reg. No.</Button>
    </Card>
  );
}
