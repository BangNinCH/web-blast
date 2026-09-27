export const rupiahFromCents = (cents) => Math.round(Number(cents ?? 0) / 100)

export const centsFromRupiah = (rupiah) => Math.round(Number(rupiah ?? 0) * 100)

export const formatRupiah = (cents) => {
  const value = rupiahFromCents(cents)
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(value)
}
