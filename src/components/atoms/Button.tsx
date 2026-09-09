import type {ButtonHTMLAttributes, ReactNode} from 'react';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {variant?: 'primary' | 'secondary' | 'ghost'; icon?: ReactNode}
export function Button({variant = 'secondary', icon, children, className = '', ...props}: Props) {
  return <button className={`button button--${variant} ${className}`} {...props}>{icon}{children}</button>;
}
export function IconButton({label, children, className = '', ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return <button className={`icon-button ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}
