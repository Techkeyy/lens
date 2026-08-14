import { LEAKS } from "@/lib/auction";

export default function LeakSheet({ kind }: { kind: keyof typeof LEAKS }) {
  const leak = LEAKS[kind];
  if (!leak) return null;
  return (
    <div className="leak">
      <p className="eyebrow">What this action reveals</p>
      <div className="leak-cols">
        <div>
          <h4>Hidden</h4>
          <ul>
            {leak.hides.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Visible on-chain</h4>
          <ul>
            {leak.shows.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
