const wonFormatter = new Intl.NumberFormat("ko-KR");

export function formatWon(amount: number): string {
  return `${wonFormatter.format(amount)}원`;
}

export function formatDate(date: string): string {
  return `${date.slice(0, 4)}.${date.slice(5, 7)}.${date.slice(8, 10)}`;
}
