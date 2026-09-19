export class UserResponseDto {
  id: number;
  name: string;
  last_name: string;
  username: string;
  email: string;
  phonenumber: string | null;
  status: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;

  static fromEntity(user: any): UserResponseDto {
    return {
      id: user.id,
      name: user.name,
      last_name: user.last_name,
      username: user.username,
      email: user.email,
      phonenumber: user.phonenumber ?? null,
      status: user.status ?? 'Active',
      is_active: user.is_active,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }
}
