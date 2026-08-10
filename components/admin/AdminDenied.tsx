export default function AdminDenied({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-800">
      <p className="font-semibold">Access Denied</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}
