import { useState } from 'react';
import Button from '../common/Button';

const initialState = {
  domain: '',
  apiEndpoint: ''
};

export default function ScanForm({ onSubmit, loading }) {
  const [form, setForm] = useState(initialState);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <form className="card form-card" onSubmit={handleSubmit}>
      <div className="card-header">
        <div>
          <h2>Run a scan</h2>
          <p>Submit a domain and/or API endpoint for scanning.</p>
        </div>
      </div>

      <div className="grid-2">
        <label>
          Domain
          <input
            name="domain"
            value={form.domain}
            onChange={handleChange}
            placeholder="example.com"
          />
        </label>

        <label>
          API endpoint
          <input
            name="apiEndpoint"
            value={form.apiEndpoint}
            onChange={handleChange}
            placeholder="https://api.example.com"
          />
        </label>
      </div>

      <div className="form-actions">
        <Button type="submit" disabled={loading}>
          {loading ? 'Running scan...' : 'Run scan'}
        </Button>
      </div>
    </form>
  );
}
