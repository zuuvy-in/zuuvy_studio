import { SitePage, findPage } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { shopContext } from "@/lib/shop";
import { currentSite } from "@/lib/site";

type Props = { params: Promise<{ path?: string[] }>; searchParams: Promise<{ cart?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const current = await currentSite();
  if (!current) return {};
  const { tree } = current.site;
  const page = findPage(tree, ((await params).path ?? []).join("/"));
  const title = page && page.path !== "/" ? `${page.title} · ${tree.meta.title}` : tree.meta.title;
  return { title, description: tree.meta.description, openGraph: { title, description: tree.meta.description } };
}

export default async function Page({ params, searchParams }: Props) {
  const current = await currentSite();
  if (!current) notFound();
  const path = ((await params).path ?? []).join("/");
  const ctx = await shopContext(current, { path: `/${path}`, cart: (await searchParams).cart });
  return <SitePage tree={current.site.tree} path={path} ctx={ctx} />;
}
