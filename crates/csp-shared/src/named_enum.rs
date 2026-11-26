//! Enums whose variants have one name each, written once.

/// Declares an enum with each variant's one name: serde's tag (saves, the wire, scripts), the key in
/// the balance tables and `name()` cannot differ.
macro_rules! named_enum {
    (
        $(#[$enum_attr:meta])*
        pub enum $enum:ident {
            $($(#[$attr:meta])* $variant:ident = $name:literal,)*
        }
    ) => {
        $(#[$enum_attr])*
        pub enum $enum {
            $($(#[$attr])* #[serde(rename = $name)] $variant,)*
        }

        impl $enum {
            /// Every one, in the order they are declared: the order of every list and table made
            /// from them.
            pub const ALL: &'static [$enum] = &[$($enum::$variant),*];

            /// Its name.
            pub const fn name(self) -> &'static str {
                match self {
                    $($enum::$variant => $name,)*
                }
            }
        }
    };
}
pub(crate) use named_enum;
