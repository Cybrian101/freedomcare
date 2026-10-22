"use client";
import { maskAadhaar } from "@/lib/aadhaar";
import type { RosterRow } from "@/lib/types";

/** Printable / screenshot-friendly token mirroring "Sample Token.pdf" fields. Print CSS is in globals via <style>. */
export function TokenSlip({ row }: { row: RosterRow }) {
  const appliance = row.appliances
    .map((a) => (a.side ? `${a.name} (${a.side})` : a.name))
    .join(", ");
  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #token-slip, #token-slip * { visibility: visible !important; }
          #token-slip { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; }
          @page { margin: 12mm; }
        }
      `}</style>
      <div
        id="token-slip"
        className="overflow-hidden rounded-xl border-2 border-slate-800 bg-emerald-50 font-serif text-slate-900 shadow"
      >
        <div className="border-b-2 border-slate-800 bg-white/60 px-4 py-3 text-center">
          <p className="font-sans text-3xl font-black tracking-tight text-blue-800">vara</p>
          <p className="font-sans text-xs text-slate-600">Freedom Trust - Mobility Aid Camp</p>
        </div>
        <div className="flex justify-between border-b-2 border-slate-800 px-4 py-2 text-sm">
          <span>
            PLACE: <b className="text-blue-700">CHENNAI</b>
          </span>
          <span>
            <b>DATE:</b> <b className="text-blue-700">24.10.2026</b>
          </span>
        </div>
        <dl className="space-y-3 px-4 py-4 text-base">
          <div>
            <b>AADHAAR NO:</b> <span className="font-bold text-blue-700">{row.aadhaar_no ? maskAadhaar(row.aadhaar_no) : "-"}</span>
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-1">
            <span>
              <b>S.NO:</b> <span className="font-bold text-blue-700">{row.serial_no ?? "-"}</span>
            </span>
            <span>
              <b>REGN NO:</b>{" "}
              <span className="text-4xl font-black leading-none text-blue-700">{row.reg_no ?? "-"}</span>
            </span>
          </div>
          <div>
            <b>NAME:</b> <span className="font-bold text-blue-700">{row.name}</span>
          </div>
          <div>
            <b>APPLIANCE:</b> <span className="font-bold text-blue-700">{appliance || "-"}</span>
          </div>
        </dl>
      </div>
      <button
        onClick={() => window.print()}
        className="mt-3 h-12 w-full rounded-xl border-2 border-slate-800 bg-white text-base font-bold text-slate-900 active:bg-slate-100 print:hidden"
      >
        Print token
      </button>
    </div>
  );
}
