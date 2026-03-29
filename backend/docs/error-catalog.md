# Error Catalog

All API error codes are defined in `src/common/errors/error-catalog.ts`.

## Adding a new error code

1. Add an entry to `ERROR_CATALOG` in `error-catalog.ts`:
   ```ts
   MY_NEW_CODE: {
     code: 'MY_NEW_CODE',
     httpStatus: HttpStatus.BAD_REQUEST,   // RFC 7231-correct status
     i18nKey: 'errors.domain.myNewCode',
     description: 'What went wrong and why.',
   },
   ```
2. Throw it with `throw new AppException('MY_NEW_CODE')`.
3. Run `npm run error-catalog:export` to regenerate `error-catalog.json` for the frontend.
4. Open a PR — required reviewers: **backend-lead** + **frontend-lead**.

## Deprecating a code

Never rename or remove a code — old clients may still receive it. Instead:

```ts
OLD_CODE: {
  ...
  deprecated: true,
  replacedBy: 'NEW_CODE',
},
```

## CI check

`npm run error-catalog:check` (runs in CI) fails if any `new AppException('CODE')` call
references a code not in the catalog.

## Frontend i18n

`src/common/errors/error-catalog.json` is the machine-readable export. Each entry contains
`httpStatus`, `i18nKey`, and `description`. The frontend maps `i18nKey` to locale strings.
