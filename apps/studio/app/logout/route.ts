import { deleteSession } from "@zsite/platform";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  // A relative Location, resolved by the browser against the address it is on.
  // Behind the load balancer request.url carries the container's own host, so
  // an absolute URL built from it sent people to an internal address.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
