import { redirect } from 'next/navigation';

/**
 * The kitchen's settings moved into Property → Hours & service (D-087), beside
 * the hotel's other standing facts. This keeps old links and bookmarks working.
 */
export default function OutletMoved() {
  redirect('/admin/property?tab=service');
}
