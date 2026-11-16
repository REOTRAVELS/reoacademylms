export default async function slugify(text, model) {
  const base = String(text || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
  let slug = base;
  let i = 1;
  while (await model.findUnique({ where: { slug } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}
