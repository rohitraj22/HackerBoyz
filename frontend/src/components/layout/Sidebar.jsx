export default function Sidebar() {
  const items = [
    'TLS posture',
    'Dependency crypto signals',
    'API visibility',
    'CBOM export',
    'Action recommendations'
  ];

  return (
    <aside className="sidebar">
      <h3>Capabilities</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </aside>
  );
}
