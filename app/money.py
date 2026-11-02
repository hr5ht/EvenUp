"""Money math. All amounts are integer paise, never floats."""


def split_equal(amount, member_ids):
    """Split amount across members; leftover paise go to the first members in order."""
    base, extra = divmod(amount, len(member_ids))
    return {m: base + (1 if i < extra else 0) for i, m in enumerate(member_ids)}


def balances(members, expenses):
    """members: [id]; expenses: [(paid_by, amount, {member_id: share})]. + is owed money."""
    bal = {m: 0 for m in members}
    for paid_by, amount, shares in expenses:
        bal[paid_by] += amount
        for m, s in shares.items():
            bal[m] -= s
    return bal


def settle(bal):
    """Greedy: largest debtor pays largest creditor. At most n-1 payments."""
    creditors = sorted([(b, n) for n, b in bal.items() if b > 0], reverse=True)
    debtors = sorted([(-b, n) for n, b in bal.items() if b < 0], reverse=True)
    payments, i, j = [], 0, 0
    while i < len(debtors) and j < len(creditors):
        owe, d = debtors[i]
        due, c = creditors[j]
        amt = min(owe, due)
        payments.append((d, c, amt))
        debtors[i] = (owe - amt, d)
        creditors[j] = (due - amt, c)
        if debtors[i][0] == 0:
            i += 1
        if creditors[j][0] == 0:
            j += 1
    return payments
