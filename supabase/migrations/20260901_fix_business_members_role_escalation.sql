drop policy if exists business_members_self_insert on business_members;

create policy business_members_self_insert on business_members
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from business_invitations
      where business_id = business_members.business_id
        and (email = (select email from auth.users where id = auth.uid())
             or user_id = auth.uid())
        and accepted_at is null
        and expires_at > now()
        and role = business_members.role
    )
    and public.is_business_subscription_active(business_members.business_id)
  );
