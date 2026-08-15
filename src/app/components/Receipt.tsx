import { explorerTx } from "@/lib/format";
import type { ActionResult } from "@/lib/strk20";

export default function Receipt({ r, networkIndex }: { r: ActionResult; networkIndex: number }) {
  return (
    <div className={`receipt ${r.status === "error" ? "err" : r.status === "pending" ? "pend" : "ok"}`}>
      <div className="receipt-head">{r.title}</div>
      {r.rows?.map((row) => (
        <div className="receipt-row" key={row.label}>
          <span>{row.label}</span>
          {row.hash ? (
            <a href={explorerTx(networkIndex, row.hash)} target="_blank" rel="noreferrer">
              {row.value}
            </a>
          ) : (
            <span className="num">{row.value}</span>
          )}
        </div>
      ))}
      {r.note ? <p className="quiet mt-20">{r.note}</p> : null}
    </div>
  );
}
