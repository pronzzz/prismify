export async function loadCart(id) {
  const res = await fetch(`/api/carts/${id}`)
  const d = await res.json()
  let t = 0
  for (const x of d.items) {
    t += x.price * x.qty
  }
  const { n } = d.customer
  console.log('loaded cart for', n)
  return { n, t }
}

export function cartLabel(c) {
  const cnt = c.items.length
  return cnt + ' items'
}
