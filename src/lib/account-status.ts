export const DEACTIVATED_ACCOUNT_ERROR_CODE = 'ACCOUNT_DEACTIVATED';
export const DEACTIVATED_ACCOUNT_ERROR_MESSAGE =
  'This account has been deactivated. Contact support if you need access restored.';

export type AccountStatusCandidate = {
  [key: string]: unknown;
  accountStatus?: string | null;
  deactivatedAt?: Date | string | null;
};

export function isDeactivatedAccount(account: AccountStatusCandidate | null | undefined): boolean {
  if (!account) {
    return false;
  }

  return account.accountStatus === 'DEACTIVATED' || Boolean(account.deactivatedAt);
}

export function getDeactivatedAccountError() {
  return {
    code: DEACTIVATED_ACCOUNT_ERROR_CODE,
    message: DEACTIVATED_ACCOUNT_ERROR_MESSAGE,
  };
}
