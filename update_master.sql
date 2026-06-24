UPDATE public.perfis
SET role = 'master'
WHERE id = (SELECT id FROM auth.users WHERE email = 'contatoevolveg@gmail.com');

SELECT id, nome, email, role
FROM public.perfis
WHERE id = (SELECT id FROM auth.users WHERE email = 'contatoevolveg@gmail.com');
