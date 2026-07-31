// Ticket 11 fills this in: shipping rate, free-shipping threshold, tax toggle,
// and contact email — the four values in the `settings` singleton, and no more.
export default function AdminSettingsPage() {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">Settings</h2>
      <p className="text-sm text-zinc-500">
        The store settings form lands here (ticket 11).
      </p>
    </section>
  );
}
