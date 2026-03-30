import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="card not-found">
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <Link className="btn btn-primary" to="/">Go back home</Link>
    </div>
  );
}
